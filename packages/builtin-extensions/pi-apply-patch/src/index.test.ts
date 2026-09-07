import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import {
	ApplyPatchError,
	applyPatch,
	applyPatchDetailed,
	createApplyPatchTool,
	registerApplyPatchExtension,
	truncatePreview,
	type ApplyPatchOperations,
} from "./index.js";
import { writeFileAtomic } from "./write-file-atomic.js";

let cwd: string;
beforeEach(async () => { cwd = await fs.mkdtemp(join(tmpdir(), "apply-patch-test-")); });
afterEach(async () => { await fs.rm(cwd, { recursive: true, force: true }); });

const wrap = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;
const put = (name: string, text: string) => fs.writeFile(join(cwd, name), text);
const get = (name: string) => fs.readFile(join(cwd, name), "utf8");
const operations: ApplyPatchOperations = {
	readFile: (filePath) => fs.readFile(filePath, "utf8"),
	writeFileAtomic,
	mkdir: async (directory) => { await fs.mkdir(directory, { recursive: true }); },
	rm: (filePath) => fs.rm(filePath),
	stat: fs.stat,
	realpath: fs.realpath,
};
const execute = (body: string, custom: ApplyPatchOperations = operations, signal?: AbortSignal) =>
	createApplyPatchTool({ operations: custom }).execute("test", { input: wrap(body) }, signal, undefined, { cwd } as ExtensionContext);
const plainTheme = {
	fg: (_name: string, text: string) => text,
	bg: (_name: string, text: string) => text,
	bold: (text: string) => text,
	inverse: (text: string) => text,
} as Theme;
const render = (result: Awaited<ReturnType<typeof execute>>, expanded = true, isError = false) => {
	const tool = createApplyPatchTool();
	const context = { cwd, isError } as Parameters<NonNullable<typeof tool.renderResult>>[3];
	return tool.renderResult!(result, { expanded, isPartial: false }, plainTheme, context).render(120).join("\n");
};

describe("patch matching and file contents", () => {
	test("counts only actual changes and keeps context in the diff", async () => {
		await put("a", "one\ntwo\nthree\n");
		const result = await applyPatchDetailed(cwd, wrap("*** Update File: a\n@@\n one\n-two\n+TWO\n three"));
		expect(result.failures).toEqual([]);
		expect(result.changes[0]).toMatchObject({ operation: "update", added: 1, removed: 1 });
		expect(result.changes[0]).toHaveProperty("unifiedDiff", "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three");
		expect(await get("a")).toBe("one\nTWO\nthree\n");
	});

	test.each(["\n", "\r\n", "\r"])("preserves %j line endings", async (ending) => {
		await put("a", ["one", "two", "three", ""].join(ending));
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n one\n-two\n+TWO\n three"));
		expect(await get("a")).toBe(["one", "TWO", "three", ""].join(ending));
	});

	test("preserves mixed endings and fuzzy context bytes", async () => {
		await put("a", "\tcontext \u2014 unchanged  \r\nold\nlast\r");
		const result = await applyPatchDetailed(cwd, wrap("*** Update File: a\n@@\n context - unchanged\n-old\n+new\n last"));
		expect(await get("a")).toBe("\tcontext \u2014 unchanged  \r\nnew\nlast\r");
		expect(result.details.fuzz).toBeGreaterThan(0);
		expect(result.changes[0]).toMatchObject({ added: 1, removed: 1 });
	});

	test("preserves BOM and missing final newline", async () => {
		await put("a", "\uFEFFone\r\ntwo");
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n-one\n+ONE\n two"));
		expect(await get("a")).toBe("\uFEFFONE\r\ntwo");
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n-two\n+TWO\n*** End of File"));
		expect(await get("a")).toBe("\uFEFFONE\r\nTWO");
	});

	test("deleting an unterminated last line does not strip the preceding terminator", async () => {
		await put("a", "one\r\ntwo");
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n-two\n*** End of File"));
		expect(await get("a")).toBe("one\r\n");
	});

	test("deleting every line leaves an empty file", async () => {
		await put("a", "one\n");
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n-one"));
		expect(await get("a")).toBe("");
	});

	test("creates an empty file and supports first block without @@", async () => {
		await applyPatch(cwd, wrap("*** Add File: a"));
		expect(await get("a")).toBe("");
		await applyPatch(cwd, wrap("*** Update File: a\n+first"));
		await applyPatch(cwd, wrap("*** Update File: a\n first\n+second"));
		expect(await get("a")).toBe("first\nsecond\n");
	});

	test("appends after existing blank lines and preserves insertion order", async () => {
		await put("a", "one\n\n");
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n+two\n@@\n+three"));
		expect(await get("a")).toBe("one\n\ntwo\nthree\n");
	});

	test("a blank context line in a headerless first block is not an EOF append", async () => {
		await put("a", "\nlast\n");
		await applyPatch(cwd, wrap("*** Update File: a\n \n+new"));
		expect(await get("a")).toBe("\nnew\nlast\n");
	});

	test("matches EOF with an omitted trailing empty context sentinel", async () => {
		await put("a", "one\ntwo\n");
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n-two\n+TWO\n \n*** End of File"));
		expect(await get("a")).toBe("one\nTWO\n");
	});

	test("uses anchors and applies separate blocks in source order", async () => {
		await put("a", "first\nold\nsecond\nold\nlast\n");
		await applyPatch(cwd, wrap("*** Update File: a\n@@ first\n-old\n+ONE\n@@ second\n-old\n+TWO"));
		expect(await get("a")).toBe("first\nONE\nsecond\nTWO\nlast\n");
	});

	test("rejects backwards EOF matches instead of overlapping replacements", async () => {
		await put("a", "one\ntwo\n");
		const result = await applyPatchDetailed(cwd, wrap("*** Update File: a\n@@\n-two\n+TWO\n@@\n-two\n+OTHER\n*** End of File"));
		expect(result.failures).toHaveLength(1);
		expect(await get("a")).toBe("one\ntwo\n");
	});

	test("rejects malformed top-level text before writing anything", async () => {
		await expect(applyPatch(cwd, wrap("*** Add File: a\n+new\n*** Delete File: b\nignored garbage"))).rejects.toThrow("expected a file header");
		expect(await fs.readdir(cwd)).toEqual([]);
	});

	test("explains unsupported unified-diff headers", async () => {
		await put("a", "old\n");
		await expect(applyPatch(cwd, wrap("*** Update File: a\n@@ -1,1 +1,1 @@\n-old\n+new"))).rejects.toThrow("not unified-diff line numbers");
		expect(await get("a")).toBe("old\n");
	});

	test("Add File overwrite is reported as an update, including empty files", async () => {
		await put("a", "old\n\nunchanged\n");
		const result = await execute("*** Add File: a\n+new\n+\n+unchanged");
		expect(result.details?.changes?.[0]).toMatchObject({ operation: "update", added: 1, removed: 1 });
		expect(render(result)).toContain("-old");
		await put("empty", "");
		const empty = await execute("*** Add File: empty\n+new");
		expect(empty.details?.changes?.[0]).toMatchObject({ operation: "update", added: 1, removed: 0 });
	});
});

describe("failures, cancellation and concurrent writes", () => {
	test("reports all failures and successful actions without showing a success title", async () => {
		await put("a", "old\n");
		const result = await execute("*** Update File: a\n@@\n-missing\n+new\n*** Add File: b\n+written");
		expect(result.details?.result?.hasPartialSuccess).toBe(true);
		expect(await get("a")).toBe("old\n");
		expect(await get("b")).toBe("written\n");
		const text = render(result, false);
		expect(text).toContain("Patch partially applied");
		expect(text).toContain("Failed to find expected lines");
		expect(text).toContain("Already applied:");
		expect(text).not.toContain("Applied patch");
	});

	test("all failures render their error even with an empty changes array", async () => {
		const result = await execute("*** Delete File: missing");
		expect(render(result)).toContain("Patch failed");
		expect(render(result)).toContain("ENOENT");
		expect(render(result)).not.toContain("Applied patch");
	});

	test("marks structured failures as SDK tool errors without discarding partial changes", async () => {
		const handlers = new Map<string, (...args: unknown[]) => unknown>();
		const pi = {
			registerTool: () => {},
			getActiveTools: () => [],
			setActiveTools: () => {},
			on: ((name: string, handler: (...args: unknown[]) => unknown) => { handlers.set(name, handler); }) as ExtensionAPI["on"],
		};
		registerApplyPatchExtension(pi);
		const result = await execute("*** Delete File: missing\n*** Add File: b\n+new");
		const event = { toolName: "apply_patch", details: result.details } as ToolResultEvent;
		expect(await handlers.get("tool_result")!(event)).toEqual({ isError: true });
		expect(result.details?.changes).toHaveLength(1);
		expect(await handlers.get("tool_result")!({ ...event, toolName: "read" })).toBeUndefined();
	});

	test.each([undefined, "previous\n"])("failed move records the committed destination (%j)", async (previous) => {
		await put("a", "old\n");
		if (previous !== undefined) await put("b", previous);
		const result = await execute("*** Update File: a\n*** Move to: b\n@@\n-old\n+new", {
			...operations,
			rm: async () => { throw new Error("source removal denied"); },
		});
		expect(await get("a")).toBe("old\n");
		expect(await get("b")).toBe("new\n");
		expect(result.details?.result?.appliedFiles).toEqual(["b"]);
		expect(result.details?.result?.hasPartialSuccess).toBe(true);
		expect(result.details?.changes?.[0]).toMatchObject({ filePath: "b", operation: previous === undefined ? "add" : "update" });
		expect(render(result)).toContain("source removal denied");
		expect(render(result)).not.toContain("No file actions were applied");
	});

	test("failed writes leave the source and destination intact", async () => {
		await put("a", "old\n");
		await put("b", "destination\n");
		const result = await execute("*** Update File: a\n*** Move to: b\n@@\n-old\n+new", {
			...operations,
			writeFileAtomic: async () => { throw new Error("write denied"); },
		});
		expect(result.details?.result?.appliedFiles).toEqual([]);
		expect(await get("a")).toBe("old\n");
		expect(await get("b")).toBe("destination\n");
	});

	test("applyPatch stops at its first failure and carries committed changes", async () => {
		let caught: unknown;
		try {
			await applyPatch(cwd, wrap("*** Add File: a\n+new\n*** Delete File: missing\n*** Add File: b\n+later"));
		} catch (error) { caught = error; }
		expect(caught).toBeInstanceOf(ApplyPatchError);
		expect((caught as ApplyPatchError).result.appliedFiles).toEqual(["a"]);
		expect((caught as Error).message).toContain("Already applied:");
		expect(await fs.readdir(cwd)).toEqual(["a"]);
	});

	test("cancellation between actions keeps earlier commits and prevents later writes", async () => {
		const controller = new AbortController();
		const result = await applyPatchDetailed(cwd, wrap("*** Add File: a\n+new\n*** Add File: b\n+later"), () => { controller.abort(); }, operations, controller.signal);
		expect(result.appliedFiles).toEqual(["a"]);
		expect(result.failures).toHaveLength(1);
		expect(await fs.readdir(cwd)).toEqual(["a"]);
	});

	test("a pre-aborted tool call writes nothing", async () => {
		await expect(execute("*** Add File: a\n+new", operations, AbortSignal.abort())).rejects.toThrow();
		expect(await fs.readdir(cwd)).toEqual([]);
	});

	test("concurrent read-modify-write operations on one file do not lose changes", async () => {
		await put("a", "one\ntwo\n");
		const delayed = {
			...operations,
			readFile: async (filePath: string) => {
				const content = await operations.readFile(filePath);
				await new Promise<void>((resolve) => setImmediate(resolve));
				return content;
			},
		};
		const results = await Promise.all([
			applyPatchDetailed(cwd, wrap("*** Update File: a\n@@\n-one\n+ONE"), undefined, delayed),
			applyPatchDetailed(cwd, wrap("*** Update File: a\n@@\n-two\n+TWO"), undefined, delayed),
		]);
		expect(results.every((result) => result.failures.length === 0)).toBe(true);
		expect(await get("a")).toBe("ONE\nTWO\n");
	});

	test("repeated file actions use the result of the previous action", async () => {
		await applyPatch(cwd, wrap("*** Add File: a\n+one\n*** Update File: a\n@@\n-one\n+two"));
		expect(await get("a")).toBe("two\n");
	});

	test("opposite moves acquire locks in the same order", async () => {
		await put("a", "one\n");
		await put("b", "two\n");
		const results = await Promise.all([
			applyPatchDetailed(cwd, wrap("*** Update File: a\n*** Move to: b")),
			applyPatchDetailed(cwd, wrap("*** Update File: b\n*** Move to: a")),
		]);
		expect(results.every((result) => result.failures.length === 0)).toBe(true);
		expect(await fs.readdir(cwd)).toHaveLength(1);
	}, 2000);

	test("progress callback exceptions do not interrupt patch application", async () => {
		const tool = createApplyPatchTool();
		const result = await tool.execute("test", { input: wrap("*** Add File: a\n+new") }, undefined, () => { throw new Error("render failed"); }, { cwd } as ExtensionContext);
		expect(result.details?.result?.failures).toEqual([]);
		expect(await get("a")).toBe("new\n");
	});

	test("failed moves are counted as one operation in progress", async () => {
		await put("a", "old\n");
		const progress: unknown[] = [];
		await applyPatchDetailed(cwd, wrap("*** Update File: a\n*** Move to: b"), (value) => { progress.push(value); }, {
			...operations,
			rm: async () => { throw new Error("denied"); },
		});
		expect(progress).toEqual([{ applied: 0, failed: 1, total: 1 }]);
	});
});

describe("file metadata and rendering", () => {
	test("preview truncation keeps indented and blank changed lines", () => {
		const context = Array.from({ length: 30 }, () => " unchanged");
		for (const change of ["+    indented", "+"]) {
			const preview = truncatePreview([...context, change, ...context].join("\n"));
			expect(preview.split("\n")).toContain(change);
			expect(preview.split("\n").length).toBeLessThanOrEqual(16);
		}
	});

	test("numeric diff content is not interpreted as a legacy line number", async () => {
		await put("a", "123 before\n");
		const result = await execute("*** Update File: a\n@@\n-123 before\n+456 after");
		expect(render(result)).toContain("-123 before");
		expect(render(result)).toContain("+456 after");
	});

	test.skipIf(process.platform === "win32")("updates and moves preserve executable permissions", async () => {
		await put("a", "old\n");
		await fs.chmod(join(cwd, "a"), 0o755);
		await applyPatch(cwd, wrap("*** Update File: a\n@@\n-old\n+new"));
		expect((await fs.stat(join(cwd, "a"))).mode & 0o777).toBe(0o755);
		await applyPatch(cwd, wrap("*** Update File: a\n*** Move to: b"));
		expect((await fs.stat(join(cwd, "b"))).mode & 0o777).toBe(0o755);
		expect(await get("b")).toBe("new\n");
	});

	test.skipIf(process.platform === "win32")("editing a symlink preserves it and changes its referent", async () => {
		await put("a", "old\n");
		await fs.symlink("a", join(cwd, "link"));
		await applyPatch(cwd, wrap("*** Update File: link\n@@\n-old\n+new"));
		expect((await fs.lstat(join(cwd, "link"))).isSymbolicLink()).toBe(true);
		expect(await get("a")).toBe("new\n");
	});

	test.skipIf(process.platform === "win32")("moving to a symlink alias of the source cannot delete the referent", async () => {
		await put("a", "old\n");
		await fs.symlink("a", join(cwd, "link"));
		await expect(applyPatch(cwd, wrap("*** Update File: a\n*** Move to: link"))).rejects.toThrow("same file");
		expect(await get("a")).toBe("old\n");
	});

	test("expanded multi-file results include file labels and do not truncate at 16 lines", async () => {
		await put("a", "old\n");
		await put("b", "before\n");
		const additions = Array.from({ length: 30 }, (_, index) => `+line${index}`).join("\n");
		const result = await execute(`*** Update File: a\n@@\n-old\n${additions}\n*** Update File: b\n@@\n-before\n+after`);
		const text = render(result);
		expect(text).toContain("+line29");
		expect(text).toMatch(/a\s*\n.*@@/);
		expect(text).toMatch(/b\s*\n.*@@/);
		expect(render(result, false)).not.toContain("+line29");
	});
});
