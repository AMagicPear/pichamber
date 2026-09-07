import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	generateUnifiedPatch,
	getAgentDir,
	getLanguageFromPath,
	highlightCode,
	type ToolDefinition,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { writeFileAtomic } from "./write-file-atomic.js";

export type ApplyPatchOperations = {
	readFile: (absolutePath: string) => Promise<string>;
	writeFileAtomic: (absolutePath: string, content: string, mode?: number) => Promise<void>;
	mkdir: (directoryPath: string) => Promise<void>;
	rm: (absolutePath: string) => Promise<void>;
	stat: (absolutePath: string) => Promise<{ mode?: number }>;
	realpath: (absolutePath: string) => Promise<string>;
};

export type ApplyPatchToolOptions = {
	operations?: ApplyPatchOperations;
	getOperations?: () => ApplyPatchOperations | undefined;
};

const LOCAL_APPLY_PATCH_OPERATIONS: ApplyPatchOperations = {
	readFile: (absolutePath) => readFile(absolutePath, "utf-8"),
	writeFileAtomic,
	mkdir: async (directoryPath) => {
		await mkdir(directoryPath, { recursive: true });
	},
	rm: async (absolutePath) => {
		await rm(absolutePath);
	},
	stat: (absolutePath) => stat(absolutePath),
	realpath: (absolutePath) => realpath(absolutePath),
};

const APPLY_PATCH_PARAMS = Type.Object({
	input: Type.String({
		description: "The entire contents of the apply_patch command",
	}),
});

type ParsedPatch =
	| { type: "add"; filePath: string; content: string }
	| { type: "delete"; filePath: string }
	| { type: "update"; filePath: string; movePath?: string; chunks: PatchChunk[] };

type PatchChunk = {
	changeContexts: string[];
	oldLines: string[];
	newLines: string[];
	contextLines: [oldIndex: number, newIndex: number][];
	isEndOfFile: boolean;
};

export type FreeformToolFormat = {
	type: "grammar";
	syntax: "lark";
	definition: string;
};

type ApplyPatchToolDefinition = ToolDefinition<typeof APPLY_PATCH_PARAMS, ApplyPatchToolDetails | undefined> & {
	freeform: FreeformToolFormat;
};

type ApplyPatchEventBus = {
	on: (channel: string, handler: (data: unknown) => void) => () => void;
};

export type ApplyPatchExtensionAPI = Pick<ExtensionAPI, "on" | "getActiveTools" | "setActiveTools"> & {
	events?: ApplyPatchEventBus;
	registerTool: (tool: ApplyPatchToolDefinition) => void;
};

const SSH_REMOTE_APPLY_PATCH_OPERATIONS_EVENT = "ssh-remote:apply-patch-operations";

type ApplyPatchParams = {
	input: string;
};

type ApplyPatchOperation = "add" | "delete" | "update";

type ApplyPatchPreviewFile = {
	filePath: string;
	movePath?: string;
	operation: ApplyPatchOperation;
	diff: string;
	added: number;
	removed: number;
};

type ApplyPatchPreview = {
	files: ApplyPatchPreviewFile[];
	added: number;
	removed: number;
};

/**
 * Codex-style per-file change that gets persisted in the final tool result.
 *
 * Stores a hunks-only standard unified diff for updates (with source line
 * numbers, but without full file content or file headers) and the
 * touched file path for adds and deletes. This keeps the session file small
 * (comparable to `edit` tool output) and lets the TUI re-render the diff
 * from the final result on demand.
 */
export type ApplyPatchFileChange =
	| { operation: "add"; filePath: string; added: number; removed: number }
	| { operation: "delete"; filePath: string; added: number; removed: number }
	| {
			operation: "update";
			filePath: string;
			movePath?: string;
			unifiedDiff: string;
			added: number;
			removed: number;
	  };

type ApplyPatchToolDetails = {
	preview?: ApplyPatchPreview;
	progress?: ApplyPatchProgress;
	result?: ApplyPatchResult;
	changes?: ApplyPatchFileChange[];
};

type ApplyPatchProgress = {
	applied: number;
	failed: number;
	total: number;
};

type ApplyPatchProgressCallback = (progress: ApplyPatchProgress) => Promise<void> | void;

async function notifyApplyPatchProgress(
	onProgress: ApplyPatchProgressCallback | undefined,
	progress: ApplyPatchProgress,
): Promise<void> {
	try {
		await onProgress?.(progress);
	} catch {
		// Rendering progress must not affect patch application or recovery details.
	}
}

export type ApplyPatchFailure = {
	filePath: string;
	operation: ApplyPatchOperation;
	message: string;
};

export type ApplyPatchResult = {
	summaries: string[];
	appliedFiles: string[];
	failures: ApplyPatchFailure[];
	hasPartialSuccess: boolean;
	changes: ApplyPatchFileChange[];
	details: {
		fuzz: number;
	};
};

export class ApplyPatchError extends Error {
	public readonly failures: ApplyPatchFailure[];
	public readonly result: ApplyPatchResult;

	constructor(message: string, result: ApplyPatchResult) {
		super(message);
		this.name = "ApplyPatchError";
		this.failures = result.failures;
		this.result = result;
	}

	hasPartialSuccess(): boolean {
		return this.result.hasPartialSuccess;
	}
}

export class PatchParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PatchParseError";
	}
}

export class PatchApplicationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PatchApplicationError";
	}
}

class PatchMoveError extends PatchApplicationError {
	constructor(message: string, readonly change: ApplyPatchFileChange) {
		super(message);
	}
}

type ApplyPatchThemeColor =
	| "accent"
	| "error"
	| "muted"
	| "toolDiffAdded"
	| "toolDiffContext"
	| "toolDiffRemoved"
	| "toolOutput"
	| "toolTitle";

type ApplyPatchThemeBg = "toolErrorBg" | "toolPendingBg" | "toolSuccessBg";

type ApplyPatchTheme = {
	fg: (name: ApplyPatchThemeColor, text: string) => string;
	bg: (name: ApplyPatchThemeBg, text: string) => string;
	bold: (text: string) => string;
	inverse: (text: string) => string;
};

function hasErrorCode(error: unknown, code: string): boolean {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

const DEFAULT_GPT_APPLY_PATCH_PROVIDERS = ["openai", "openai-codex"] as const;
export const APPLY_PATCH_LOCAL_CONFIG_PATH = path.join(getAgentDir(), "pi-apply-patch.json");

type ApplyPatchLocalConfig = {
	providers?: unknown;
};

function getGPTApplyPatchProviders(): Set<string> {
	try {
		const config = JSON.parse(readFileSync(APPLY_PATCH_LOCAL_CONFIG_PATH, "utf8")) as ApplyPatchLocalConfig;
		if (Array.isArray(config.providers)) {
			const providers = config.providers.filter(
				(provider): provider is string => typeof provider === "string" && provider.length > 0,
			);
			if (providers.length > 0) {
				return new Set(providers);
			}
		}
	} catch {
		// Missing or invalid local config falls back to standard providers.
	}
	return new Set(DEFAULT_GPT_APPLY_PATCH_PROVIDERS);
}
export const PATCH_PREVIEW_MAX_LINES = 16;
export const PATCH_PREVIEW_MAX_CHARS = 4000;
const PATCH_PREVIEW_HEAD_LINES = 8;
const PATCH_PREVIEW_TAIL_LINES = PATCH_PREVIEW_MAX_LINES - PATCH_PREVIEW_HEAD_LINES - 1;
const PATCH_PREVIEW_TRUNCATION_MARKER = "…";
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)m`, "g");

function applyLayeredBackground(theme: ApplyPatchTheme, bgName: ApplyPatchThemeBg, text: string): string {
	const marker = "\x1fpi-bg-marker\x1f";
	const wrappedMarker = theme.bg(bgName, marker);
	const markerIndex = wrappedMarker.indexOf(marker);
	if (markerIndex === -1) {
		return theme.bg(bgName, text);
	}

	const bgStart = wrappedMarker.slice(0, markerIndex);
	const bgEnd = wrappedMarker.slice(markerIndex + marker.length);
	const restored = text.replace(ANSI_SGR, (sequence: string, params: string) => {
		if (params === "" || params.split(";").some((param) => param === "0" || param === "49")) {
			return `${sequence}${bgStart}`;
		}
		return sequence;
	});
	return `${bgStart}${restored}${bgEnd}`;
}

function isChangedPreviewLine(line: string): boolean {
	return /^[+-]/.test(line);
}

function countWindowLines(lines: string[], start: number, end: number): number {
	return end - start + (start > 0 ? 1 : 0) + (end < lines.length ? 1 : 0);
}

function formatPreviewWindow(lines: string[], start: number, end: number): string {
	const previewLines = lines.slice(start, end);
	if (start > 0) {
		previewLines.unshift("…");
	}
	if (end < lines.length) {
		previewLines.push("…");
	}
	return previewLines.join("\n");
}

function createChangedHunkPreview(lines: string[]): string | undefined {
	const firstChangedLine = lines.findIndex(isChangedPreviewLine);
	if (firstChangedLine === -1) {
		return undefined;
	}

	let start = firstChangedLine;
	let end = firstChangedLine + 1;
	while (end < lines.length) {
		const line = lines[end];
		if (line === undefined || !isChangedPreviewLine(line)) {
			break;
		}
		end++;
	}

	const changedHunkEnd = end;
	while (end > start && countWindowLines(lines, start, end) > PATCH_PREVIEW_MAX_LINES) {
		end--;
	}

	while (countWindowLines(lines, start, end) < PATCH_PREVIEW_MAX_LINES) {
		const canAddBefore = start > 0;
		const canAddAfter = end < lines.length;
		if (!canAddBefore && !canAddAfter) {
			break;
		}

		const beforeContextLines = firstChangedLine - start;
		const afterContextLines = end - changedHunkEnd;
		if (canAddBefore && (!canAddAfter || beforeContextLines <= afterContextLines)) {
			start--;
		} else {
			end++;
		}
	}

	return formatPreviewWindow(lines, start, end);
}

function countLines(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	let lines = 1;
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) === 10) {
			lines += 1;
		}
	}
	return lines;
}

function enforcePreviewCharLimit(preview: string): string {
	if (preview.length <= PATCH_PREVIEW_MAX_CHARS) {
		return preview;
	}

	return `${preview.slice(0, PATCH_PREVIEW_MAX_CHARS - PATCH_PREVIEW_TRUNCATION_MARKER.length).trimEnd()}${PATCH_PREVIEW_TRUNCATION_MARKER}`;
}

export function truncatePreview(text: string): string {
	if (text.length <= PATCH_PREVIEW_MAX_CHARS && countLines(text) <= PATCH_PREVIEW_MAX_LINES) {
		return text;
	}

	const lines = text.split("\n");
	const changedHunkPreview = createChangedHunkPreview(lines);
	const previewText =
		changedHunkPreview ??
		[...lines.slice(0, PATCH_PREVIEW_HEAD_LINES), "…", ...lines.slice(-PATCH_PREVIEW_TAIL_LINES)].join("\n");
	return enforcePreviewCharLimit(previewText);
}

function normalizeApplyPatchArguments(args: unknown): ApplyPatchParams {
	if (typeof args === "string") {
		return { input: args };
	}

	if (args && typeof args === "object" && "input" in args) {
		const input = (args as { input?: unknown }).input;
		if (typeof input === "string") {
			return { input };
		}
	}

	return { input: "" };
}

const STANDARD_EDIT_TOOL_NAMES = ["edit", "write"] as const;
export const APPLY_PATCH_FREEFORM_DESCRIPTION =
	"Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.";
export const APPLY_PATCH_LARK_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line*
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /[^\\n]+/
add_line: "+" /[^\\n]+/? LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /[^\\n]+/? LF
eof_line: "*** End of File" LF

%import common.LF
`;

export function isOpenAIGptModel(model: Pick<Model<string>, "provider" | "id"> | undefined): boolean {
	return (
		model !== undefined &&
		getGPTApplyPatchProviders().has(model.provider) &&
		model.id.toLowerCase().startsWith("gpt-")
	);
}

function normalizePatchText(patchText: string): string {
	return patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripHeredoc(input: string): string {
	const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
	if (heredocMatch) {
		return heredocMatch[2] ?? input;
	}
	return input;
}

function normalizeSeekLine(line: string): string {
	return line
		.trim()
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function seekSequence(
	lines: string[],
	pattern: string[],
	start: number,
	eof: boolean,
): { index: number; fuzz: 0 | 1 | 100 | 10000 } | undefined {
	if (pattern.length === 0) {
		return { index: start, fuzz: 0 };
	}
	if (pattern.length > lines.length) {
		return undefined;
	}

	const searchStart = eof ? Math.max(lines.length - pattern.length, start) : start;
	const lastStart = lines.length - pattern.length;
	const matches = (index: number, compare: (left: string, right: string) => boolean): boolean => {
		for (let patternIndex = 0; patternIndex < pattern.length; patternIndex++) {
			const line = lines[index + patternIndex];
			const expected = pattern[patternIndex];
			if (line === undefined || expected === undefined || !compare(line, expected)) {
				return false;
			}
		}
		return true;
	};
	const matchesPrepared = (index: number, preparedLines: string[], preparedPattern: string[]): boolean => {
		for (let patternIndex = 0; patternIndex < preparedPattern.length; patternIndex++) {
			const line = preparedLines[index + patternIndex];
			const expected = preparedPattern[patternIndex];
			if (line === undefined || expected === undefined || line !== expected) {
				return false;
			}
		}
		return true;
	};

	for (let index = searchStart; index <= lastStart; index++) {
		if (matches(index, (line, expected) => line === expected)) {
			return { index, fuzz: 0 };
		}
	}
	const linesTrimEnd = lines.map((line) => line.trimEnd());
	const patternTrimEnd = pattern.map((line) => line.trimEnd());
	for (let index = searchStart; index <= lastStart; index++) {
		if (matchesPrepared(index, linesTrimEnd, patternTrimEnd)) {
			return { index, fuzz: 1 };
		}
	}
	const linesTrim = lines.map((line) => line.trim());
	const patternTrim = pattern.map((line) => line.trim());
	for (let index = searchStart; index <= lastStart; index++) {
		if (matchesPrepared(index, linesTrim, patternTrim)) {
			return { index, fuzz: 100 };
		}
	}
	const linesNormalized = lines.map(normalizeSeekLine);
	const patternNormalized = pattern.map(normalizeSeekLine);
	for (let index = searchStart; index <= lastStart; index++) {
		if (matchesPrepared(index, linesNormalized, patternNormalized)) {
			return { index, fuzz: 10000 };
		}
	}

	return undefined;
}

export function extractPatchedPaths(patchText: string): string[] {
	const normalized = stripHeredoc(normalizePatchText(patchText));
	const matches = normalized.matchAll(/^\*\*\* (?:(?:Add|Delete|Update) File|Move to): (.+)$/gm);
	return Array.from(matches, (match) => match[1] ?? "");
}

function countDiffLines(content: string): number {
	if (content === "") return 0;
	const lines = content.split("\n");
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines.length;
}

const formatUnifiedDiff = (filePath: string, before: string, after: string) => {
	const patch = generateUnifiedPatch(filePath, before, after, 3);
	const patchLines = patch.split("\n");
	if (patchLines.at(-1) === "") patchLines.pop();
	const start = patchLines.findIndex((line) => line.startsWith("@@ "));
	const lines = start === -1 ? [] : patchLines.slice(start);
	const diff = lines.join("\n");
	return {
		diff,
		added: lines.filter((line) => line.startsWith("+")).length,
		removed: lines.filter((line) => line.startsWith("-")).length,
	};
};

const readOptionalFile = async (absolutePath: string, operations: ApplyPatchOperations) => {
	try {
		return await operations.readFile(absolutePath);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return undefined;
		}
		throw error;
	}
};

function formatApplyPatchChanges(
	changes: ApplyPatchFileChange[],
	cwd: string,
	expanded: boolean,
	theme: ApplyPatchTheme,
): string {
	if (changes.length === 0) {
		return "";
	}

	const lines: string[] = [];
	const totalAdded = changes.reduce((sum, c) => sum + c.added, 0);
	const totalRemoved = changes.reduce((sum, c) => sum + c.removed, 0);

	// Header
	if (changes.length === 1) {
		const change = changes[0];
		if (!change) return "";
		const op = formatPatchOperation(change.operation);
		const fp = displayPath(change.filePath, cwd);
		const count = `(+${change.added} -${change.removed})`;
		const target =
			change.operation === "update" && change.movePath ? `${fp} → ${displayPath(change.movePath, cwd)}` : fp;
		lines.push(theme.fg("toolTitle", theme.bold(`${op} ${target}`)));
		lines.push(`  ${count}`);
	} else {
		lines.push(theme.fg("toolTitle", theme.bold(`Edited ${changes.length} files`)));
		lines.push(`  ${formatLineCountSummary(totalAdded, totalRemoved)}`);
		for (const change of changes) {
			const op = formatPatchOperation(change.operation);
			const fp = displayPath(change.filePath, cwd);
			const count = `(+${change.added} -${change.removed})`;
			const target =
				change.operation === "update" && change.movePath ? `${fp} → ${displayPath(change.movePath, cwd)}` : fp;
			lines.push(`  └ ${op} ${target} ${count}`);
		}
	}

	if (expanded) {
		for (const change of changes) {
			if (change.operation === "update" && change.unifiedDiff) {
				const target = change.movePath ?? change.filePath;
				if (changes.length > 1) {
					lines.push(theme.fg("toolTitle", displayPath(target, cwd)));
				}
				const diff = renderOpenCodeLikeDiff(change.unifiedDiff, target, theme);
				lines.push(...diff.split("\n").map((line) => `    ${line}`));
			}
		}
	}

	return lines.join("\n");
}

function formatLineCountSummary(added: number, removed: number): string {
	return `(+${added} -${removed})`;
}

function formatPatchFileSummary(file: ApplyPatchPreviewFile, cwd: string): string {
	return `${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`;
}

function formatPatchFileHeader(file: ApplyPatchPreviewFile, cwd: string): string {
	return `• ${formatPatchOperation(file.operation)} ${formatPatchFileSummary(file, cwd)}`;
}

function normalizeDisplayPath(filePath: string): string {
	return filePath.replaceAll(path.sep, "/");
}

export function displayPath(filePath: string, cwd: string): string {
	if (!path.isAbsolute(filePath)) {
		return normalizeDisplayPath(filePath);
	}

	const absoluteCwd = path.resolve(cwd);
	const relativePath = path.relative(absoluteCwd, filePath);
	if (
		relativePath === "" ||
		(!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
	) {
		return normalizeDisplayPath(relativePath || ".");
	}

	return normalizeDisplayPath(filePath);
}

export function formatPatchFilePath(file: ApplyPatchPreviewFile, cwd: string = process.cwd()): string {
	const filePath = displayPath(file.filePath, cwd);
	if (!file.movePath) {
		return filePath;
	}
	return `${filePath} → ${displayPath(file.movePath, cwd)}`;
}

function formatPatchOperation(operation: ApplyPatchOperation): string {
	if (operation === "add") {
		return "Added";
	}
	if (operation === "delete") {
		return "Deleted";
	}
	return "Edited";
}

export function formatPatchPreview(
	preview: ApplyPatchPreview,
	cwd: string = process.cwd(),
	expanded: boolean = true,
): string {
	const lines: string[] = [];
	if (preview.files.length === 1) {
		const file = preview.files[0];
		if (file) {
			lines.push(formatPatchFileHeader(file, cwd));
			if (expanded && file.diff) {
				lines.push(
					...truncatePreview(file.diff)
						.split("\n")
						.map((line) => `  ${line}`),
				);
			}
		}
		return lines.join("\n");
	}

	const noun = "files";
	lines.push(`• Edited ${preview.files.length} ${noun} ${formatLineCountSummary(preview.added, preview.removed)}`);
	for (const file of preview.files) {
		lines.push(`  └ ${formatPatchFileSummary(file, cwd)}`);
		if (expanded && file.diff) {
			lines.push(
				...truncatePreview(file.diff)
					.split("\n")
					.map((line) => `    ${line}`),
			);
		}
	}
	return lines.join("\n");
}

export function formatInFlightCallText(patchText: string): string {
	const paths = extractPatchedPaths(patchText);
	if (paths.length === 0) {
		return "Patching";
	}
	const noun = paths.length === 1 ? "file" : "files";
	const count = paths.length > 1 ? ` (${paths.length} ${noun})` : "";
	return `Patching${count}: ${paths.join(", ")}`;
}

type RenderableAddedDiffLine = { content: string; kind: "added"; lineNumber: string; sign: "+" };
type RenderableRemovedDiffLine = { content: string; kind: "removed"; lineNumber: string; sign: "-" };
type RenderableContextDiffLine = { content: string; kind: "context"; lineNumber: string; sign: " " };
type RenderableContentDiffLine = RenderableAddedDiffLine | RenderableContextDiffLine | RenderableRemovedDiffLine;
type RenderableDiffLine = RenderableContentDiffLine | { kind: "meta"; text: string };

function parseRenderableDiffLine(line: string): RenderableDiffLine {
	const sign = line[0];
	const content = line.slice(1).replace(/\r$/, "");
	if (sign === "+") return { content, kind: "added", lineNumber: "", sign };
	if (sign === "-") return { content, kind: "removed", lineNumber: "", sign };
	if (sign === " ") return { content, kind: "context", lineNumber: "", sign };
	return { kind: "meta", text: line };
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function highlightDiffContent(content: string, filePath: string): string {
	const plainContent = replaceTabs(content);
	const language = getLanguageFromPath(filePath);
	try {
		return highlightCode(plainContent, language)[0] ?? plainContent;
	} catch {
		return plainContent;
	}
}

function renderInlineDiff(
	oldContent: string,
	newContent: string,
	theme: ApplyPatchTheme,
): { added: string; removed: string } {
	const oldText = replaceTabs(oldContent);
	const newText = replaceTabs(newContent);
	let prefix = 0;
	while (prefix < oldText.length && prefix < newText.length && oldText[prefix] === newText[prefix]) {
		prefix++;
	}
	let suffix = 0;
	while (
		suffix < oldText.length - prefix &&
		suffix < newText.length - prefix &&
		oldText[oldText.length - suffix - 1] === newText[newText.length - suffix - 1]
	) {
		suffix++;
	}

	const oldMiddleEnd = oldText.length - suffix;
	const newMiddleEnd = newText.length - suffix;
	const oldMiddle = oldText.slice(prefix, oldMiddleEnd);
	const newMiddle = newText.slice(prefix, newMiddleEnd);
	const commonPrefix = oldText.slice(0, prefix);
	const commonSuffix = suffix > 0 ? oldText.slice(oldMiddleEnd) : "";
	const added = `${commonPrefix}${newMiddle ? theme.inverse(newMiddle) : ""}${commonSuffix}`;
	const removed = `${commonPrefix}${oldMiddle ? theme.inverse(oldMiddle) : ""}${commonSuffix}`;
	return { added, removed };
}

function renderOpenCodeLikeDiffLine(
	line: RenderableContentDiffLine,
	filePath: string,
	theme: ApplyPatchTheme,
	contentOverride?: string,
): string {
	const lineNumberPart = line.lineNumber ? `${theme.fg("muted", line.lineNumber)} ` : "";
	if (line.kind === "context") {
		return `${theme.fg("toolDiffContext", line.sign)}${lineNumberPart}${highlightDiffContent(line.content, filePath)}`;
	}

	const diffColor = line.kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
	const background = line.kind === "added" ? "toolSuccessBg" : "toolErrorBg";
	const content =
		contentOverride === undefined
			? highlightDiffContent(line.content, filePath)
			: theme.fg(diffColor, replaceTabs(contentOverride));
	const rendered = `${theme.fg(diffColor, line.sign)}${lineNumberPart}${content}`;
	return theme.bg(background, rendered);
}

function renderOpenCodeLikeDiff(diffText: string, filePath: string, theme: ApplyPatchTheme): string {
	const parsedLines = diffText.split("\n").map(parseRenderableDiffLine);
	const rendered: string[] = [];
	let index = 0;

	while (index < parsedLines.length) {
		const line = parsedLines[index];
		if (!line) {
			index++;
			continue;
		}

		if (line.kind !== "removed") {
			rendered.push(
				line.kind === "meta"
					? theme.fg("toolDiffContext", line.text)
					: renderOpenCodeLikeDiffLine(line, filePath, theme),
			);
			index++;
			continue;
		}

		const removedLines: RenderableRemovedDiffLine[] = [];
		while (parsedLines[index]?.kind === "removed") {
			const removedLine = parsedLines[index];
			if (removedLine?.kind === "removed") {
				removedLines.push(removedLine);
			}
			index++;
		}

		const addedLines: RenderableAddedDiffLine[] = [];
		while (parsedLines[index]?.kind === "added") {
			const addedLine = parsedLines[index];
			if (addedLine?.kind === "added") {
				addedLines.push(addedLine);
			}
			index++;
		}

		const pairedCount = Math.min(removedLines.length, addedLines.length);
		for (let pairIndex = 0; pairIndex < pairedCount; pairIndex++) {
			const removedLine = removedLines[pairIndex];
			const addedLine = addedLines[pairIndex];
			if (!removedLine || !addedLine) {
				continue;
			}

			const inline = renderInlineDiff(removedLine.content, addedLine.content, theme);
			rendered.push(renderOpenCodeLikeDiffLine(removedLine, filePath, theme, inline.removed));
			rendered.push(renderOpenCodeLikeDiffLine(addedLine, filePath, theme, inline.added));
		}

		for (const removedLine of removedLines.slice(pairedCount)) {
			rendered.push(renderOpenCodeLikeDiffLine(removedLine, filePath, theme));
		}
		for (const addedLine of addedLines.slice(pairedCount)) {
			rendered.push(renderOpenCodeLikeDiffLine(addedLine, filePath, theme));
		}
	}

	return rendered.join("\n");
}

function renderPatchPreview(
	preview: ApplyPatchPreview,
	cwd: string,
	theme: ApplyPatchTheme,
	expanded: boolean,
): string {
	if (expanded) {
		try {
			const renderFile = (file: ApplyPatchPreviewFile, headerPrefix: string): string => {
				const header = formatPatchFileHeader(file, cwd);
				if (!file.diff) {
					return headerPrefix.length > 0 ? `${headerPrefix}${formatPatchFileSummary(file, cwd)}` : header;
				}
				const previewDiff = truncatePreview(file.diff);
				const renderedDiff = renderOpenCodeLikeDiff(previewDiff, file.movePath ?? file.filePath, theme);
				if (headerPrefix.length > 0) {
					const nestedHeader = `${headerPrefix}${formatPatchFileSummary(file, cwd)}`;
					return `${nestedHeader}\n${renderedDiff
						.split("\n")
						.map((line) => `    ${line}`)
						.join("\n")}`;
				}
				return `${header}\n${renderedDiff}`;
			};

			if (preview.files.length === 1) {
				const file = preview.files[0];
				return file ? renderFile(file, "") : "";
			}

			const noun = "files";
			const renderedFiles = preview.files.map((file) => renderFile(file, "  └ ")).join("\n");
			if (renderedFiles.length > 0) {
				return `• Edited ${preview.files.length} ${noun} ${formatLineCountSummary(preview.added, preview.removed)}\n${renderedFiles}`;
			}
		} catch {
			// fall back to manual themed line rendering
		}
	}

	return formatPatchPreview(preview, cwd, expanded)
		.split("\n")
		.map((line) => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith("+")) {
				return theme.fg("toolDiffAdded", line);
			}
			if (trimmed.startsWith("-")) {
				return theme.fg("toolDiffRemoved", line);
			}
			if (trimmed.startsWith("•")) {
				return theme.fg("toolTitle", theme.bold(line));
			}
			if (trimmed.startsWith("└")) {
				return theme.fg("accent", line);
			}
			return theme.fg("toolDiffContext", line);
		})
		.join("\n");
}

function formatPendingPatchPaths(patchText: string): string {
	const paths = extractPatchedPaths(patchText);
	if (paths.length === 0) {
		return "Applying patch...";
	}
	return `Applying patch...\n${paths.map((filePath) => `• ${filePath}`).join("\n")}`;
}

async function createPatchPreview(
	cwd: string,
	hunks: ParsedPatch[],
	operations: ApplyPatchOperations,
): Promise<ApplyPatchPreview> {
	const files: ApplyPatchPreviewFile[] = [];
	for (const hunk of hunks) {
		const absolutePath = await resolvePatchPath(cwd, hunk.filePath, operations);
		if (hunk.type === "add") {
			const oldContent = await readOptionalFile(absolutePath, operations);
			if (oldContent !== undefined) {
				files.push({ filePath: hunk.filePath, operation: "update", ...formatUnifiedDiff(hunk.filePath, oldContent, hunk.content) });
			} else {
				const added = countDiffLines(hunk.content);
				files.push({ filePath: hunk.filePath, operation: "add", diff: "", added, removed: 0 });
			}
			continue;
		}

		if (hunk.type === "delete") {
			const oldContent = await operations.readFile(absolutePath);
			const removed = splitFileLines(oldContent).length;
			files.push({ filePath: hunk.filePath, operation: "delete", diff: "", added: 0, removed });
			continue;
		}

		const before = await operations.readFile(absolutePath);
		const after = hunk.chunks.length ? replaceChunks(before, hunk.filePath, hunk.chunks).content : before;
		const unified = formatUnifiedDiff(hunk.filePath, before, after);
		if (hunk.movePath) {
			await resolvePatchPath(cwd, hunk.movePath, operations);
		}
		files.push({
			filePath: hunk.filePath,
			operation: "update",
			diff: unified.diff,
			added: unified.added,
			removed: unified.removed,
			...(hunk.movePath !== undefined ? { movePath: hunk.movePath } : {}),
		});
	}

	return {
		files,
		added: files.reduce((sum, file) => sum + file.added, 0),
		removed: files.reduce((sum, file) => sum + file.removed, 0),
	};
}

function parsePatch(patchText: string): ParsedPatch[] {
	const normalized = stripHeredoc(normalizePatchText(patchText).trim()).trim();
	const lines = normalized.split("\n");
	const beginIndex = lines[0]?.trim() === "*** Begin Patch" ? 0 : -1;
	const lastLine = lines[lines.length - 1];
	const endIndex = lastLine?.trim() === "*** End Patch" ? lines.length - 1 : -1;

	if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
		throw new PatchParseError("Invalid patch format: expected *** Begin Patch ... *** End Patch envelope");
	}

	const hunks: ParsedPatch[] = [];
	let index = beginIndex + 1;
	while (index < endIndex) {
		const line = lines[index] ?? "";
		if (!line.startsWith("*** ")) {
			if (line.trim() !== "") throw new PatchParseError(`Invalid patch at line ${index + 1}: expected a file header, got '${line}'`);
			index++;
			continue;
		}

		if (line.startsWith("*** Add File: ")) {
			const filePath = line.slice("*** Add File: ".length);
			index++;
			const contentLines: string[] = [];
			while (index < endIndex) {
				const nextLine = lines[index] ?? "";
				if (nextLine.startsWith("*** ")) {
					break;
				}
				if (!nextLine.startsWith("+")) {
					throw new PatchParseError(`Invalid patch format: Add File lines must start with '+'`);
				}
				contentLines.push(nextLine.slice(1));
				index++;
			}
			hunks.push({
				type: "add",
				filePath,
				content: contentLines.length === 0 ? "" : `${contentLines.join("\n")}\n`,
			});
			continue;
		}

		if (line.startsWith("*** Delete File: ")) {
			hunks.push({ type: "delete", filePath: line.slice("*** Delete File: ".length) });
			index++;
			continue;
		}

		if (line.startsWith("*** Update File: ")) {
			const filePath = line.slice("*** Update File: ".length);
			index++;
			let movePath: string | undefined;
			if ((lines[index] ?? "").startsWith("*** Move to: ")) {
				movePath = (lines[index] ?? "").slice("*** Move to: ".length);
				index++;
			}

			const chunks: PatchChunk[] = [];
			while (index < endIndex) {
				const nextLine = lines[index] ?? "";
				if (nextLine === "") {
					index++;
					continue;
				}
				if (nextLine.startsWith("*** ")) {
					break;
				}

				const allowMissingContext = chunks.length === 0;
				const changeContexts: string[] = [];
				if (nextLine.startsWith("@@")) {
					while (index < endIndex) {
						const contextLine = lines[index] ?? "";
						if (/^@@ -\d/.test(contextLine)) {
							throw new PatchParseError(`Invalid update at line ${index + 1}: use '@@' or '@@ <existing source line>', not unified-diff line numbers`);
						}
						if (contextLine === "@@") {
							index++;
							continue;
						}
						if (contextLine.startsWith("@@ ")) {
							changeContexts.push(contextLine.slice("@@ ".length));
							index++;
							continue;
						}
						break;
					}
				} else if (!allowMissingContext) {
					throw new PatchParseError(`Expected update hunk to start with a @@ context marker, got: '${nextLine}'`);
				}

				const oldLines: string[] = [];
				const newLines: string[] = [];
				const contextLines: PatchChunk["contextLines"] = [];
				let isEndOfFile = false;
				let parsedLines = 0;
				while (index < endIndex) {
					const hunkLine = lines[index] ?? "";
					if (hunkLine === "*** End of File") {
						if (parsedLines === 0) {
							throw new PatchParseError("Update hunk does not contain any lines");
						}
						isEndOfFile = true;
						index++;
						break;
					}
					if (hunkLine.startsWith("@@") || hunkLine.startsWith("*** ")) {
						break;
					}
					const prefix = hunkLine[0];
					const value = hunkLine.slice(1);
					if (prefix === undefined) {
						contextLines.push([oldLines.length, newLines.length]);
						oldLines.push("");
						newLines.push("");
					} else if (prefix === " ") {
						contextLines.push([oldLines.length, newLines.length]);
						oldLines.push(value);
						newLines.push(value);
					} else if (prefix === "-") {
						oldLines.push(value);
					} else if (prefix === "+") {
						newLines.push(value);
					} else if (parsedLines > 0) {
						break;
					} else {
						throw new PatchParseError(
							`Unexpected line found in update hunk: '${hunkLine}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
						);
					}
					parsedLines++;
					index++;
				}

				if (parsedLines === 0) {
					throw new PatchParseError("Update hunk does not contain any lines");
				}
				chunks.push({ changeContexts, oldLines, newLines, contextLines, isEndOfFile });
			}
			if (chunks.length === 0 && !movePath) {
				throw new PatchParseError(`Update file hunk for path '${filePath}' is empty`);
			}

			hunks.push(
				movePath !== undefined
					? { type: "update", filePath, movePath, chunks }
					: { type: "update", filePath, chunks },
			);
			continue;
		}

		throw new PatchParseError(
			`'${line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
		);
	}

	return hunks;
}

function parseNonEmptyPatch(patchText: string): ParsedPatch[] {
	const hunks = parsePatch(patchText);
	if (hunks.length > 0) {
		return hunks;
	}

	const normalized = normalizePatchText(patchText).trim();
	if (normalized === "*** Begin Patch\n*** End Patch") {
		throw new PatchParseError("patch rejected: empty patch");
	}
	throw new PatchParseError("apply_patch verification failed: no hunks found");
}

function splitFileLines(content: string): string[] {
	const lines = normalizePatchText(content).split("\n");
	if (lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

const replaceChunks = (content: string, filePath: string, chunks: PatchChunk[]) => {
	const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
	const sourceLines = (content.slice(bom.length).match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []).map((line) => {
		const ending = line.match(/\r\n$|[\r\n]$/)?.[0] ?? "";
		return { text: ending ? line.slice(0, -ending.length) : line, ending };
	});
	const originalLines = sourceLines.map((line) => line.text);
	const preferredEnding = sourceLines.find((line) => line.ending)?.ending ?? "\n";
	const replacements: { start: number; oldLength: number; newLines: string[] }[] = [];
	let lineIndex = 0;
	let fuzz = 0;

	for (const chunk of chunks) {
		for (const changeContext of chunk.changeContexts) {
			const contextMatch = seekSequence(originalLines, [changeContext], lineIndex, false);
			if (contextMatch === undefined) {
				throw new PatchApplicationError(`Failed to find context '${changeContext}' in ${filePath}`);
			}
			fuzz += contextMatch.fuzz;
			lineIndex = contextMatch.index + 1;
		}

		if (chunk.oldLines.length === 0) {
			replacements.push({ start: originalLines.length, oldLength: 0, newLines: chunk.newLines });
			continue;
		}

		let pattern = chunk.oldLines;
		let newLines = chunk.newLines;
		let foundAt = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		if (foundAt === undefined && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newLines[newLines.length - 1] === "") {
				newLines = newLines.slice(0, -1);
			}
			foundAt = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		}

		if (foundAt === undefined) {
			throw new PatchApplicationError(`Failed to find expected lines in ${filePath} after line ${lineIndex}${chunk.isEndOfFile ? " at EOF" : ""}:\n${chunk.oldLines.join("\n")}\nCheck the current file and keep chunks in source order with non-overlapping context.`);
		}

		fuzz += foundAt.fuzz;
		// Context is a locator, not a replacement. Preserve its original bytes even after fuzzy matching.
		let oldStart = 0;
		let newStart = 0;
		for (const [oldContext, newContext] of chunk.contextLines) {
			if (oldContext >= pattern.length || newContext >= newLines.length) break;
			if (oldStart !== oldContext || newStart !== newContext) {
				replacements.push({ start: foundAt.index + oldStart, oldLength: oldContext - oldStart, newLines: newLines.slice(newStart, newContext) });
			}
			oldStart = oldContext + 1;
			newStart = newContext + 1;
		}
		if (oldStart !== pattern.length || newStart !== newLines.length) {
			replacements.push({ start: foundAt.index + oldStart, oldLength: pattern.length - oldStart, newLines: newLines.slice(newStart) });
		}
		lineIndex = foundAt.index + pattern.length;
	}

	const nextLines = [...sourceLines];
	// Reverse a stable ascending sort so insertions at the same position retain patch order.
	for (const replacement of replacements.sort((left, right) => left.start - right.start).reverse()) {
		const inserted = replacement.newLines.map((text, index) => ({
			text,
			ending: sourceLines[replacement.start + Math.min(index, replacement.oldLength - 1)]?.ending || preferredEnding,
		}));
		nextLines.splice(replacement.start, replacement.oldLength, ...inserted);
	}
	if (sourceLines.length > 0 && sourceLines.at(-1)?.ending === "" && nextLines.length > 0 && !sourceLines.includes(nextLines.at(-1)!)) {
		nextLines[nextLines.length - 1] = { ...nextLines[nextLines.length - 1]!, ending: "" };
	}
	return { content: bom + nextLines.map((line, index) => line.text + (line.ending || (index < nextLines.length - 1 ? preferredEnding : ""))).join(""), fuzz };
};

async function applySingleHunk(
	cwd: string,
	hunk: ParsedPatch,
	operations: ApplyPatchOperations,
	signal?: AbortSignal,
): Promise<{
	summary: string;
	appliedFile: string;
	fuzz: number;
	change: ApplyPatchFileChange;
}> {
	const absolutePath = await resolvePatchPath(cwd, hunk.filePath, operations);
	if (hunk.type === "add") {
		const previous = await readOptionalFile(absolutePath, operations);
		await operations.mkdir(path.dirname(absolutePath));
		signal?.throwIfAborted();
		await operations.writeFileAtomic(absolutePath, hunk.content);
		const change = describeWrittenFile(hunk.filePath, previous, hunk.content);
		return {
			summary: `${change.operation}: ${hunk.filePath}`,
			appliedFile: hunk.filePath,
			fuzz: 0,
			change,
		};
	}

	if (hunk.type === "delete") {
		await operations.stat(absolutePath);
		const oldContent = await operations.readFile(absolutePath);
		signal?.throwIfAborted();
		await operations.rm(absolutePath);
		const removed = splitFileLines(oldContent).length;
		return {
			summary: `delete: ${hunk.filePath}`,
			appliedFile: hunk.filePath,
			fuzz: 0,
			change: { operation: "delete", filePath: hunk.filePath, added: 0, removed },
		};
	}

	const currentContent = await operations.readFile(absolutePath);
	const chunkResult =
		hunk.chunks.length === 0
			? { content: currentContent, fuzz: 0 }
			: replaceChunks(currentContent, hunk.filePath, hunk.chunks);
	const nextContent = chunkResult.content;
	const unified = formatUnifiedDiff(hunk.filePath, currentContent, nextContent);
	const change: ApplyPatchFileChange = {
		operation: "update",
		filePath: hunk.filePath,
		unifiedDiff: unified.diff,
		added: unified.added,
		removed: unified.removed,
	};

	if (hunk.movePath) {
		const absoluteMovePath = await resolvePatchPath(cwd, hunk.movePath, operations);
		const previous = await readOptionalFile(absoluteMovePath, operations);
		const { mode } = await operations.stat(absolutePath);
		await operations.mkdir(path.dirname(absoluteMovePath));
		signal?.throwIfAborted();
		await operations.writeFileAtomic(absoluteMovePath, nextContent, mode === undefined ? undefined : mode & 0o7777);
		if (absoluteMovePath !== absolutePath) {
			try {
				await operations.rm(absolutePath);
			} catch (error) {
				throw new PatchMoveError(
					`Wrote ${hunk.movePath}, but failed to remove ${hunk.filePath}: ${error instanceof Error ? error.message : String(error)}`,
					describeWrittenFile(hunk.movePath, previous, nextContent),
				);
			}
		}
		change.movePath = hunk.movePath;
		return {
			summary: `move: ${hunk.filePath} -> ${hunk.movePath}`,
			appliedFile: hunk.movePath,
			fuzz: chunkResult.fuzz,
			change,
		};
	}

	signal?.throwIfAborted();
	await operations.writeFileAtomic(absolutePath, nextContent);
	return { summary: `update: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: chunkResult.fuzz, change };
}

const describeWrittenFile = (filePath: string, before: string | undefined, after: string): ApplyPatchFileChange => {
	if (before === undefined) return { operation: "add", filePath, added: countDiffLines(after), removed: 0 };
	const { diff: unifiedDiff, added, removed } = formatUnifiedDiff(filePath, before, after);
	return { operation: "update", filePath, unifiedDiff, added, removed };
};

const applyQueuedHunk = async (cwd: string, hunk: ParsedPatch, operations: ApplyPatchOperations, signal?: AbortSignal) => {
	const paths = [hunk.filePath, ...(hunk.type === "update" && hunk.movePath ? [hunk.movePath] : [])];
	const targets: string[] = [];
	for (const filePath of paths) {
		const absolutePath = await resolvePatchPath(cwd, filePath, operations);
		targets.push(await operations.realpath(absolutePath).catch((error: unknown) => {
			if (hasErrorCode(error, "ENOENT")) return absolutePath;
			throw error;
		}));
	}
	// Lock canonical paths in one order so opposite moves cannot deadlock.
	const uniqueTargets = [...new Set(targets)].sort();
	if (targets.length === 2 && uniqueTargets.length === 1 && hunk.type === "update" &&
		path.resolve(cwd, hunk.filePath) !== path.resolve(cwd, hunk.movePath!)) {
		throw new PatchApplicationError(`Cannot move ${hunk.filePath} to ${hunk.movePath}: both paths resolve to the same file`);
	}
	const run = (index: number): ReturnType<typeof applySingleHunk> => {
		signal?.throwIfAborted();
		const target = uniqueTargets[index];
		return target === undefined
			? applySingleHunk(cwd, hunk, operations, signal)
			: withFileMutationQueue(target, () => run(index + 1));
	};
	return run(0);
};

export async function applyPatchDetailed(
	cwd: string,
	patchText: string,
	onProgress?: ApplyPatchProgressCallback,
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
	signal?: AbortSignal,
): Promise<ApplyPatchResult> {
	return applyParsedPatchDetailed(cwd, parseNonEmptyPatch(patchText), onProgress, operations, signal);
}

async function applyParsedPatchDetailed(
	cwd: string,
	hunks: ParsedPatch[],
	onProgress?: ApplyPatchProgressCallback,
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
	signal?: AbortSignal,
	stopOnFailure = false,
): Promise<ApplyPatchResult> {
	const summaries: string[] = [];
	const appliedFiles: string[] = [];
	const failures: ApplyPatchFailure[] = [];
	const changes: ApplyPatchFileChange[] = [];
	let fuzz = 0;
	let applied = 0;

	for (const hunk of hunks) {
		try {
			const { summary, appliedFile, fuzz: hunkFuzz, change } = await applyQueuedHunk(cwd, hunk, operations, signal);
			summaries.push(summary);
			appliedFiles.push(appliedFile);
			fuzz += hunkFuzz;
			changes.push(change);
			applied++;
		} catch (error) {
			if (error instanceof PatchMoveError) {
				changes.push(error.change);
				appliedFiles.push(error.change.filePath);
				summaries.push(`${error.change.operation}: ${error.change.filePath} (source removal failed)`);
			}
			const message = error instanceof Error ? error.message : String(error);
			failures.push({ filePath: hunk.filePath, operation: hunk.type, message });
		}
		await notifyApplyPatchProgress(onProgress, {
			applied,
			failed: failures.length,
			total: hunks.length,
		});
		if (stopOnFailure && failures.length > 0) break;
	}

	const result: ApplyPatchResult = {
		summaries,
		appliedFiles,
		failures,
		changes,
		hasPartialSuccess: appliedFiles.length > 0 && failures.length > 0,
		details: { fuzz },
	};
	return result;
}

export async function applyPatch(
	cwd: string,
	patchText: string,
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
): Promise<string[]> {
	const result = await applyParsedPatchDetailed(cwd, parseNonEmptyPatch(patchText), undefined, operations, undefined, true);
	if (result.failures.length > 0) throw new ApplyPatchError(formatApplyPatchResult(result), result);
	return result.summaries;
}

const formatApplyPatchResult = (result: ApplyPatchResult) => {
	const blocks = result.failures.map((failure) => `${failure.operation}: ${failure.filePath}\n${failure.message}`);
	if (result.failures.length > 0) {
		blocks.push(result.appliedFiles.length ? `Already applied:\n${result.summaries.join("\n")}` : "No file actions were applied.");
	} else {
		blocks.push(result.summaries.join("\n"));
	}
	if (result.details.fuzz > 0) blocks.push("Note: fuzzy context matching was used. Review the diff to verify the intended changes.");
	const output = truncateHead(blocks.join("\n\n"));
	return output.content + (output.truncated ? "\n[Patch output truncated; inspect the affected files before retrying.]" : "");
};

async function createPendingPatchUpdate(
	cwd: string,
	patchText: string,
	progress?: ApplyPatchProgress,
	parsedHunks?: ParsedPatch[],
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
): Promise<{ text: string; details: ApplyPatchToolDetails | undefined }> {
	const title = progress
		? `Applying patch (${progress.applied + progress.failed}/${progress.total})...`
		: "Applying patch...";
	try {
		const hunks = parsedHunks ?? parsePatch(patchText);
		if (hunks.length === 0) {
			return { text: title, details: progress ? { progress } : undefined };
		}

		const preview = await createPatchPreview(cwd, hunks, operations);
		const details: ApplyPatchToolDetails = { preview };
		if (progress) details.progress = progress;
		return { text: `${title}\n${formatPatchPreview(preview, cwd)}`, details };
	} catch {
		return {
			text: progress ? title : formatPendingPatchPaths(patchText),
			details: progress ? { progress } : undefined,
		};
	}

}

function withoutExtensionManagedEditTools(toolNames: string[]): string[] {
	return toolNames.filter(
		(toolName) =>
			toolName !== "apply_patch" && !STANDARD_EDIT_TOOL_NAMES.some((editToolName) => editToolName === toolName),
	);
}

function replaceEditToolsWithApplyPatch(toolNames: string[]): string[] {
	return [...withoutExtensionManagedEditTools(toolNames), "apply_patch"];
}

function replaceApplyPatchWithEditTools(toolNames: string[]): string[] {
	return [...withoutExtensionManagedEditTools(toolNames), ...STANDARD_EDIT_TOOL_NAMES];
}

async function resolvePatchPath(
	cwd: string,
	filePath: string,
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
): Promise<string> {
	if (filePath.trim() === "" || filePath.includes("\0")) throw new PatchParseError("Patch file paths must be non-empty and contain no NUL characters");
	const basePath = await operations.realpath(cwd);
	const absolutePath = path.resolve(basePath, filePath);
	return absolutePath;
}

function syncToolset(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
	model: Model<string> | undefined,
): void {
	const currentToolNames = pi.getActiveTools();
	if (isOpenAIGptModel(model)) {
		pi.setActiveTools(replaceEditToolsWithApplyPatch(currentToolNames));
		return;
	}

	pi.setActiveTools(replaceApplyPatchWithEditTools(currentToolNames));
}

export function createApplyPatchTool(options: ApplyPatchToolOptions = {}): ApplyPatchToolDefinition {
	const tool = defineTool({
		name: "apply_patch",
		label: "ApplyPatch",
		description: APPLY_PATCH_FREEFORM_DESCRIPTION,
		parameters: APPLY_PATCH_PARAMS,
		prepareArguments: normalizeApplyPatchArguments,
		promptSnippet:
			"Use the `apply_patch` tool to edit files (NEVER try `applypatch` or `apply-patch`, only `apply_patch`).",
		promptGuidelines: [
			"Patches MUST begin with `*** Begin Patch` and end with `*** End Patch`.",
			"Use one of these operation headers per file: `*** Add File: <path>`, `*** Delete File: <path>`, `*** Update File: <path>`.",
			"Every added line must start with `+`, removed lines with `-`, unchanged context with a single space.",
			"Use `*** Move to: <new path>` directly after `*** Update File:` to rename; use `*** End of File` only when the hunk reaches actual EOF.",
			"For apply_patch updates, separate change blocks with `@@`; optionally use `@@ <existing source line>` to locate a class/function. Do not use unified-diff line numbers.",
			"Keep apply_patch blocks in source order with non-overlapping context. Include enough unchanged lines to identify the intended occurrence; a block with only '+' lines appends at EOF.",
			"File references MUST be relative — never absolute.",
			"Avoid redundant reads after apply_patch succeeds, but inspect the diff or affected files when verification or failure recovery requires it. Retry only unapplied changes after a partial failure.",
			"Do not edit files via bash, Python, or heredocs when `apply_patch` is available.",
		],
		async execute(
			_toolCallId,
			params,
			signal,
			onUpdate,
			ctx,
		): Promise<AgentToolResult<ApplyPatchToolDetails | undefined>> {
			signal?.throwIfAborted();
			const normalizedParams = normalizeApplyPatchArguments(params);
			if (!normalizedParams.input) {
				throw new Error("input is required");
			}

			const operations = options.getOperations?.() ?? options.operations ?? LOCAL_APPLY_PATCH_OPERATIONS;
			const parsedHunks = parseNonEmptyPatch(normalizedParams.input);
			const totalOperations = parsedHunks.length;
			const initialProgress = totalOperations > 0 ? { applied: 0, failed: 0, total: totalOperations } : undefined;
			const pendingUpdate = await createPendingPatchUpdate(
				ctx.cwd,
				normalizedParams.input,
				initialProgress,
				parsedHunks,
				operations,
			);
			try {
				onUpdate?.({ content: [{ type: "text", text: pendingUpdate.text }], details: pendingUpdate.details });
			} catch {
				// UI callbacks must not stop a filesystem operation.
			}

			const preview = pendingUpdate.details?.preview;
			const result = await applyParsedPatchDetailed(
				ctx.cwd,
				parsedHunks,
				(progress) => {
					onUpdate?.({
						content: [{ type: "text", text: `Applying patch (${progress.applied + progress.failed}/${progress.total})...` }],
						details: { preview, progress },
					});
				},
				operations,
				signal,
			);

			return {
				content: [{ type: "text", text: formatApplyPatchResult(result) }],
				details: { result, changes: result.changes },
			};
		},
		renderCall(args, theme, context) {
			if (!context.argsComplete) {
				return new Text(theme.fg("toolTitle", theme.bold("apply_patch: Patching")), 0, 0);
			}

			const normalizedArgs = normalizeApplyPatchArguments(args);
			const text = `apply_patch: ${formatInFlightCallText(normalizedArgs.input)}`;
			return new Text(theme.fg("toolTitle", theme.bold(text)), 0, 0);
		},
		renderResult(result, options, theme, context) {
			const component = new Container();
			const changes = result.details?.changes;
			const preview = result.details?.preview;

			// Final (settled) result: render from Codex-style changes when available.
			if (changes && !options.isPartial) {
				const failed = context.isError || Boolean(result.details?.result?.failures.length);
				const bgName = failed ? "toolErrorBg" : "toolSuccessBg";
				const box = new Box(1, 1, (text: string) => applyLayeredBackground(theme, bgName, text));
				const title = failed ? (changes.length ? "Patch partially applied" : "Patch failed") : "Applied patch";
				box.addChild(new Text(theme.fg("toolTitle", theme.bold(title)), 0, 0));
				if (failed) {
					box.addChild(new Text(result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"), 0, 0));
				} else if (result.details?.result?.details.fuzz) {
					box.addChild(new Text(theme.fg("muted", "Fuzzy context matching used; verify the diff."), 0, 0));
				}
				box.addChild(new Spacer(1));
				box.addChild(
					new Text(formatApplyPatchChanges(changes, context.cwd, options.expanded ?? true, theme), 0, 0),
				);
				component.addChild(box);
				return component;
			}

			// Streaming results use a bounded preview; settled, expanded results show the full diff.
			if (preview) {
				const bgName = options.isPartial ? "toolPendingBg" : "toolSuccessBg";
				const progress = result.details?.progress;
				const title = progress
					? `Applying patch (${progress.applied + progress.failed}/${progress.total})`
					: "Applying patch";
				const box = new Box(1, 1, (text: string) => applyLayeredBackground(theme, bgName, text));
				box.addChild(new Text(theme.fg("toolTitle", theme.bold(title)), 0, 0));
				box.addChild(new Spacer(1));
				const expanded = options.isPartial ? true : (options.expanded ?? true);
				box.addChild(new Text(renderPatchPreview(preview, context.cwd, theme, expanded), 0, 0));
				component.addChild(box);
				return component;
			}

			const text = result.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.filter((value) => typeof value === "string" && value.length > 0)
				.join("\n");
			if (text) {
				component.addChild(new Text(theme.fg(context.isError ? "error" : "toolOutput", text), 0, 0));
			}
			return component;
		},
	});

	return Object.assign(tool, {
		freeform: {
			type: "grammar",
			syntax: "lark",
			definition: APPLY_PATCH_LARK_GRAMMAR,
		} satisfies FreeformToolFormat,
	});
}

export function registerApplyPatchExtension(pi: ApplyPatchExtensionAPI): void {
	let remoteOperations: ApplyPatchOperations | undefined;
	pi.events?.on(SSH_REMOTE_APPLY_PATCH_OPERATIONS_EVENT, (data) => {
		if (typeof data !== "object" || data === null) {
			remoteOperations = undefined;
			return;
		}
		remoteOperations = (data as { operations?: ApplyPatchOperations | null }).operations ?? undefined;
	});

	pi.registerTool(createApplyPatchTool({ getOperations: () => remoteOperations }));
	// The SDK sets failure status via tool_result. Keep structured partial changes instead of losing them to a throw.
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "apply_patch") return;
		const details = event.details as ApplyPatchToolDetails | undefined;
		if (details?.result?.failures.length) return { isError: true };
	});

	pi.on("session_start", async (_event, ctx) => {
		syncToolset(pi, ctx.model);
	});

	pi.on("model_select", async (event) => {
		syncToolset(pi, event.model);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		syncToolset(pi, ctx.model);
	});
}

export default registerApplyPatchExtension;
