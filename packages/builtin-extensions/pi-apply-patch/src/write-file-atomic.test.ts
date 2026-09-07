import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic, type AtomicWriteOperations } from "./write-file-atomic.js";

let cwd: string;
beforeEach(async () => { cwd = await fs.mkdtemp(join(tmpdir(), "atomic-patch-test-")); });
afterEach(async () => { await fs.rm(cwd, { recursive: true, force: true }); });
const operations: AtomicWriteOperations = fs;

test.skipIf(process.platform === "win32").each([0o600, 0o755])("retains mode %i", async (mode) => {
	const target = join(cwd, "a");
	await fs.writeFile(target, "before");
	await fs.chmod(target, mode);
	await writeFileAtomic(target, "after");
	expect((await fs.stat(target)).mode & 0o777).toBe(mode);
	expect(await fs.readFile(target, "utf8")).toBe("after");
	expect(await fs.readdir(cwd)).toEqual(["a"]);
});

test.each(["EEXIST", "EPERM", "ENOSPC"])("rename failure %s keeps the original and cleans the temporary file", async (code) => {
	const target = join(cwd, "a");
	await fs.writeFile(target, "before");
	await expect(writeFileAtomic(target, "after", undefined, {
		...operations,
		rename: async () => { throw Object.assign(new Error("rename failed"), { code }); },
	})).rejects.toThrow("rename failed");
	expect(await fs.readFile(target, "utf8")).toBe("before");
	expect(await fs.readdir(cwd)).toEqual(["a"]);
});

test("a partial temporary write failure is cleaned up", async () => {
	const target = join(cwd, "a");
	await fs.writeFile(target, "before");
	await expect(writeFileAtomic(target, "after", undefined, {
		...operations,
		writeFile: async (filePath, _content, options) => {
			await fs.writeFile(filePath, "partial", options);
			throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
		},
	})).rejects.toThrow("disk full");
	expect(await fs.readFile(target, "utf8")).toBe("before");
	expect(await fs.readdir(cwd)).toEqual(["a"]);
});

test("chmod failure preserves the original and removes the temporary file", async () => {
	const target = join(cwd, "a");
	await fs.writeFile(target, "before");
	await expect(writeFileAtomic(target, "after", undefined, {
		...operations,
		chmod: async () => { throw new Error("chmod denied"); },
	})).rejects.toThrow("chmod denied");
	expect(await fs.readFile(target, "utf8")).toBe("before");
	expect(await fs.readdir(cwd)).toEqual(["a"]);
});

test.skipIf(process.platform === "win32")("dangling symlinks are not replaced by regular files", async () => {
	const target = join(cwd, "link");
	await fs.symlink("missing", target);
	await expect(writeFileAtomic(target, "after")).rejects.toThrow();
	expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
	expect(await fs.readdir(cwd)).toEqual(["link"]);
});

test("near-limit filenames do not make the temporary filename too long", async () => {
	const name = "a".repeat(250);
	await writeFileAtomic(join(cwd, name), "new");
	expect(await fs.readFile(join(cwd, name), "utf8")).toBe("new");
	expect(await fs.readdir(cwd)).toEqual([name]);
});

test("a temporary-file collision does not remove the other writer's file", async () => {
	const target = join(cwd, "a");
	let occupied = "";
	await expect(writeFileAtomic(target, "after", undefined, {
		...operations,
		writeFile: async (filePath, _content, options) => {
			occupied = filePath;
			await fs.writeFile(filePath, "other writer", options);
			throw Object.assign(new Error("collision"), { code: "EEXIST" });
		},
	})).rejects.toThrow("collision");
	expect(await fs.readFile(occupied, "utf8")).toBe("other writer");
	expect(await fs.readdir(cwd)).toHaveLength(1);
});

test("write access denial does not bypass a read-only target by replacing its inode", async () => {
	const target = join(cwd, "a");
	await fs.writeFile(target, "before");
	await expect(writeFileAtomic(target, "after", undefined, {
		...operations,
		access: async () => { throw Object.assign(new Error("write denied"), { code: "EACCES" }); },
	})).rejects.toThrow("write denied");
	expect(await fs.readFile(target, "utf8")).toBe("before");
	expect(await fs.readdir(cwd)).toEqual(["a"]);
});
