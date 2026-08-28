import { readFileSync } from "node:fs";
import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
	defineTool,
	type ExtensionAPI,
	getAgentDir,
	getLanguageFromPath,
	highlightCode,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { writeFileAtomic } from "./write-file-atomic.js";

export type ApplyPatchOperations = {
	readFile: (absolutePath: string) => Promise<string>;
	writeFileAtomic: (absolutePath: string, content: string) => Promise<void>;
	mkdir: (directoryPath: string) => Promise<void>;
	rm: (absolutePath: string) => Promise<void>;
	stat: (absolutePath: string) => Promise<unknown>;
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
 * Mirrors the shape of `FileChange` in openai/codex: only the hunks-only
 * unified diff for updates (no full file content, no line numbers) and the
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

export type ApplyPatchRecoveryInstructions = {
	mustReadFiles: string[];
	mustNotReadFiles: string[];
};

export type ApplyPatchResult = {
	summaries: string[];
	appliedFiles: string[];
	failures: ApplyPatchFailure[];
	hasPartialSuccess: boolean;
	recoveryInstructions: ApplyPatchRecoveryInstructions;
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

type ApplyPatchRenderState = {
	cwd: string;
	patchText: string;
	callText: string;
	collapsed: string;
	expanded: string;
};

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
const applyPatchRenderStates = new Map<string, ApplyPatchRenderState>();
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
	return /^[+-](?:\s*\d+\s|[^\s])/.test(line);
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
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
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

	const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start;
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

/**
 * Codex-style hunks-only unified diff (no line numbers, no full-file context).
 *
 * Produces the same format as Codex's @format_update_chunks_for_progress:
 * ``@@ <context>`` headers followed by ``-old`` / ``+new`` lines, with an
 * optional ``*** End of File`` marker when the parser sets isEndOfFile.
 */
function formatUnifiedDiff(chunks: PatchChunk[]): { diff: string; added: number; removed: number } {
	const output: string[] = [];
	let added = 0;
	let removed = 0;
	for (const chunk of chunks) {
		if (chunk.changeContexts.length > 0) {
			for (const context of chunk.changeContexts) {
				output.push(`@@ ${context}`);
			}
		} else {
			output.push("@@");
		}
		for (const line of chunk.oldLines) {
			output.push(`-${line}`);
			removed++;
		}
		for (const line of chunk.newLines) {
			output.push(`+${line}`);
			added++;
		}
		if (chunk.isEndOfFile) {
			output.push("*** End of File");
		}
	}
	return { diff: output.join("\n"), added, removed };
}

async function readExistingFileForPreview(absolutePath: string, operations: ApplyPatchOperations): Promise<string> {
	try {
		return await operations.readFile(absolutePath);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return "";
		}
		throw error;
	}
}

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
				const diffLines = truncatePreview(change.unifiedDiff).split("\n");
				for (const diffLine of diffLines) {
					if (diffLine.startsWith("-")) {
						lines.push(`    ${theme.fg("toolDiffRemoved", diffLine)}`);
					} else if (diffLine.startsWith("+")) {
						lines.push(`    ${theme.fg("toolDiffAdded", diffLine)}`);
					} else if (diffLine.startsWith("@@") || diffLine.startsWith("***")) {
						lines.push(`    ${theme.fg("muted", diffLine)}`);
					} else {
						lines.push(`    ${diffLine}`);
					}
				}
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

function getApplyPatchRenderState(toolCallId: string, cwd: string, patchText: string): ApplyPatchRenderState {
	const existing = applyPatchRenderStates.get(toolCallId);
	if (existing && existing.cwd === cwd && existing.patchText === patchText) {
		return existing;
	}

	const callText = formatInFlightCallText(patchText);
	let collapsed = "";
	let expanded = "";
	try {
		const hunks = parsePatch(patchText);
		if (hunks.length > 0) {
			const files = hunks.map((hunk) => {
				const file = {
					filePath: hunk.filePath,
					operation: hunk.type,
					diff: "",
					added: 0,
					removed: 0,
				} satisfies ApplyPatchPreviewFile;
				return hunk.type === "update" && hunk.movePath !== undefined ? { ...file, movePath: hunk.movePath } : file;
			}) satisfies ApplyPatchPreviewFile[];
			const preview: ApplyPatchPreview = { files, added: 0, removed: 0 };
			collapsed = formatPatchPreview(preview, cwd, false);
			expanded = formatPatchPreview(preview, cwd, true);
		}
	} catch {
		// leave summaries empty for partial/incomplete patch text
	}

	const nextState: ApplyPatchRenderState = { cwd, patchText, callText, collapsed, expanded };
	applyPatchRenderStates.set(toolCallId, nextState);
	return nextState;
}

export function clearApplyPatchRenderState(): void {
	applyPatchRenderStates.clear();
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
	// Handle Codex-style format (no line numbers): +content, -content
	const simpleMatch = line.match(/^([+-])(?!\s*\d)(.*)$/);
	if (simpleMatch) {
		const sign = simpleMatch[1];
		const content = simpleMatch[2] ?? "";
		if (sign === "+") {
			return { content, kind: "added", lineNumber: "", sign };
		}
		if (sign === "-") {
			return { content, kind: "removed", lineNumber: "", sign };
		}
	}

	// Handle legacy format (line-numbered): +1 content, -1 content,  1 content
	const match = line.match(/^([+\- ])(\s*\d+)\s(.*)$/);
	if (!match) {
		return { kind: "meta", text: line };
	}

	const sign = match[1];
	const lineNumber = match[2];
	if ((sign !== "+" && sign !== "-" && sign !== " ") || lineNumber === undefined) {
		return { kind: "meta", text: line };
	}

	const content = match[3] ?? "";
	if (sign === "+") {
		return { content, kind: "added", lineNumber, sign };
	}
	if (sign === "-") {
		return { content, kind: "removed", lineNumber, sign };
	}
	return { content, kind: "context", lineNumber, sign };
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
			const oldContent = await readExistingFileForPreview(absolutePath, operations);
			if (oldContent.length > 0) {
				// Overwriting existing file — render as update with a minimal inline diff.
				const removed = splitFileLines(oldContent).length;
				const added = countDiffLines(hunk.content);
				const diff = [
					"@@",
					...oldContent
						.split("\n")
						.filter((line) => line !== "")
						.map((line) => `-${line}`),
					...hunk.content
						.split("\n")
						.filter((line) => line !== "")
						.map((line) => `+${line}`),
				].join("\n");
				files.push({ filePath: hunk.filePath, operation: "update", diff, added, removed });
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

		const unified = formatUnifiedDiff(hunk.chunks);
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
				if (nextLine.trim() === "") {
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
						oldLines.push("");
						newLines.push("");
					} else if (prefix === " ") {
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
				chunks.push({ changeContexts, oldLines, newLines, isEndOfFile });
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

function replaceChunks(content: string, filePath: string, chunks: PatchChunk[]): { content: string; fuzz: number } {
	const originalLines = splitFileLines(content);
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
			const insertionIndex =
				originalLines[originalLines.length - 1] === "" ? originalLines.length - 1 : originalLines.length;
			replacements.push({ start: insertionIndex, oldLength: 0, newLines: chunk.newLines });
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
			throw new PatchApplicationError(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`);
		}

		fuzz += foundAt.fuzz;
		replacements.push({ start: foundAt.index, oldLength: pattern.length, newLines });
		lineIndex = foundAt.index + pattern.length;
	}

	const nextLines = [...originalLines];
	for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
		nextLines.splice(replacement.start, replacement.oldLength, ...replacement.newLines);
	}
	nextLines.push("");
	return { content: nextLines.join("\n"), fuzz };
}

async function applySingleHunk(
	cwd: string,
	hunk: ParsedPatch,
	operations: ApplyPatchOperations,
): Promise<{
	summary: string;
	appliedFile: string;
	fuzz: number;
	change: ApplyPatchFileChange;
}> {
	const absolutePath = await resolvePatchPath(cwd, hunk.filePath, operations);
	if (hunk.type === "add") {
		await operations.mkdir(path.dirname(absolutePath));
		await operations.writeFileAtomic(absolutePath, hunk.content);
		const added = countDiffLines(hunk.content);
		return {
			summary: `add: ${hunk.filePath}`,
			appliedFile: hunk.filePath,
			fuzz: 0,
			change: { operation: "add", filePath: hunk.filePath, added, removed: 0 },
		};
	}

	if (hunk.type === "delete") {
		await operations.stat(absolutePath);
		const oldContent = await operations.readFile(absolutePath);
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
	const unified = formatUnifiedDiff(hunk.chunks);
	const change: ApplyPatchFileChange = {
		operation: "update",
		filePath: hunk.filePath,
		unifiedDiff: unified.diff,
		added: unified.added,
		removed: unified.removed,
	};

	if (hunk.movePath) {
		const absoluteMovePath = await resolvePatchPath(cwd, hunk.movePath, operations);
		await operations.mkdir(path.dirname(absoluteMovePath));
		await operations.writeFileAtomic(absoluteMovePath, nextContent);
		if (absoluteMovePath !== absolutePath) {
			await operations.rm(absolutePath);
		}
		change.movePath = hunk.movePath;
		return {
			summary: `move: ${hunk.filePath} -> ${hunk.movePath}`,
			appliedFile: hunk.movePath,
			fuzz: chunkResult.fuzz,
			change,
		};
	}

	await operations.writeFileAtomic(absolutePath, nextContent);
	return { summary: `update: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: chunkResult.fuzz, change };
}

export async function applyPatchDetailed(
	cwd: string,
	patchText: string,
	onProgress?: ApplyPatchProgressCallback,
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
): Promise<ApplyPatchResult> {
	return applyParsedPatchDetailed(cwd, parseNonEmptyPatch(patchText), onProgress, operations);
}

async function applyParsedPatchDetailed(
	cwd: string,
	hunks: ParsedPatch[],
	onProgress?: ApplyPatchProgressCallback,
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
): Promise<ApplyPatchResult> {
	const summaries: string[] = [];
	const appliedFiles: string[] = [];
	const failures: ApplyPatchFailure[] = [];
	const changes: ApplyPatchFileChange[] = [];
	let fuzz = 0;

	for (const hunk of hunks) {
		try {
			const { summary, appliedFile, fuzz: hunkFuzz, change } = await applySingleHunk(cwd, hunk, operations);
			summaries.push(summary);
			appliedFiles.push(appliedFile);
			fuzz += hunkFuzz;
			changes.push(change);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push({ filePath: hunk.filePath, operation: hunk.type, message });
		}
		await notifyApplyPatchProgress(onProgress, {
			applied: appliedFiles.length,
			failed: failures.length,
			total: hunks.length,
		});
	}

	const result: ApplyPatchResult = {
		summaries,
		appliedFiles,
		failures,
		changes,
		hasPartialSuccess: appliedFiles.length > 0 && failures.length > 0,
		recoveryInstructions: { mustReadFiles: [], mustNotReadFiles: [] },
		details: { fuzz },
	};
	result.recoveryInstructions = createRecoveryInstructions(result);
	return result;
}

function createRecoveryInstructions(
	result: Pick<ApplyPatchResult, "appliedFiles" | "failures">,
): ApplyPatchRecoveryInstructions {
	const mustReadFiles = [...new Set(result.failures.map((failure) => failure.filePath))];
	const mustReadFileSet = new Set(mustReadFiles);
	const mustNotReadFiles = [...new Set(result.appliedFiles.filter((filePath) => !mustReadFileSet.has(filePath)))];
	return { mustReadFiles, mustNotReadFiles };
}

export async function applyPatch(
	cwd: string,
	patchText: string,
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
): Promise<string[]> {
	const hunks = parseNonEmptyPatch(patchText);

	const summaries: string[] = [];
	const appliedFiles: string[] = [];
	const changes: ApplyPatchFileChange[] = [];
	for (const hunk of hunks) {
		try {
			const { summary, appliedFile, change } = await applySingleHunk(cwd, hunk, operations);
			summaries.push(summary);
			appliedFiles.push(appliedFile);
			changes.push(change);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const failure = { filePath: hunk.filePath, operation: hunk.type, message } satisfies ApplyPatchFailure;
			const result: ApplyPatchResult = {
				summaries,
				appliedFiles,
				changes,
				failures: [failure],
				hasPartialSuccess: appliedFiles.length > 0,
				recoveryInstructions: createRecoveryInstructions({
					appliedFiles,
					failures: [failure],
				}),
				details: { fuzz: 0 },
			};
			throw new ApplyPatchError(message, result);
		}
	}

	return summaries;
}

async function createPendingPatchUpdate(
	cwd: string,
	patchText: string,
	progress?: ApplyPatchProgress,
	previewOverride?: ApplyPatchPreview,
	parsedHunks?: ParsedPatch[],
	operations: ApplyPatchOperations = LOCAL_APPLY_PATCH_OPERATIONS,
): Promise<{ text: string; details: ApplyPatchToolDetails | undefined }> {
	const title = progress
		? `Applying patch (${progress.applied + progress.failed}/${progress.total})...`
		: "Applying patch...";
	if (previewOverride) {
		const details: ApplyPatchToolDetails = { preview: previewOverride };
		if (progress) details.progress = progress;
		return {
			text: `${title}\n${formatPatchPreview(previewOverride, cwd)}`,
			details,
		};
	}

	try {
		const hunks = parsedHunks ?? parsePatch(patchText);
		if (hunks.length === 0) {
			return { text: title, details: progress ? { progress } : undefined };
		}

		const preview = await createPatchPreview(cwd, hunks, operations);
		if (preview.files.some((file) => file.diff.trim().length > 0)) {
			const details: ApplyPatchToolDetails = { preview };
			if (progress) details.progress = progress;
			return { text: `${title}\n${formatPatchPreview(preview, cwd)}`, details };
		}
	} catch {
		return {
			text: progress ? title : formatPendingPatchPaths(patchText),
			details: progress ? { progress } : undefined,
		};
	}

	return { text: progress ? title : formatPendingPatchPaths(patchText), details: progress ? { progress } : undefined };
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
			"Use `@@` (optionally with a class/function header) when 3 lines of context are insufficient to uniquely identify the snippet.",
			"File references MUST be relative — never absolute.",
			"Do not re-read files after `apply_patch` succeeds.",
			"Do not edit files via bash, Python, or heredocs when `apply_patch` is available.",
		],
		async execute(
			_toolCallId,
			params,
			_signal,
			onUpdate,
			ctx,
		): Promise<AgentToolResult<ApplyPatchToolDetails | undefined>> {
			const normalizedParams = normalizeApplyPatchArguments(params);
			if (!normalizedParams.input) {
				throw new Error("input is required");
			}

			const operations = options.getOperations?.() ?? options.operations ?? LOCAL_APPLY_PATCH_OPERATIONS;
			let parsedHunks: ParsedPatch[] | undefined;
			try {
				parsedHunks = parseNonEmptyPatch(normalizedParams.input);
			} catch {
				// createPendingPatchUpdate keeps incomplete or invalid patch text renderable.
			}
			const totalOperations = parsedHunks?.length ?? 0;
			const initialProgress = totalOperations > 0 ? { applied: 0, failed: 0, total: totalOperations } : undefined;
			const pendingUpdate = await createPendingPatchUpdate(
				ctx.cwd,
				normalizedParams.input,
				initialProgress,
				undefined,
				parsedHunks,
				operations,
			);
			onUpdate?.({
				content: [{ type: "text", text: pendingUpdate.text }],
				details: pendingUpdate.details,
			});

			const preview = pendingUpdate.details?.preview;
			const result = await applyParsedPatchDetailed(
				ctx.cwd,
				parsedHunks ?? parseNonEmptyPatch(normalizedParams.input),
				async (progress) => {
					const progressUpdate = await createPendingPatchUpdate(
						ctx.cwd,
						normalizedParams.input,
						progress,
						preview,
						parsedHunks,
						operations,
					);
					onUpdate?.({
						content: [{ type: "text", text: progressUpdate.text }],
						details: progressUpdate.details,
					});
				},
				operations,
			);
			if (result.failures.length > 0) {
				// Match Codex behaviour: surface the raw per-failure error message and
				// report which hunks already landed on disk. Do not inject prescriptive
				// recovery instructions — the model can refresh its view of any file
				// via the normal read tools, and a turn-level diff (Codex tracks this
				// separately) is out of scope for this extension.
				const blocks: string[] = [];
				for (const failure of result.failures) {
					blocks.push(failure.message);
				}
				const tail =
					result.appliedFiles.length > 0
						? `Already applied: ${result.appliedFiles.join(", ")}`
						: "No file actions were applied.";
				return {
					content: [{ type: "text", text: `${blocks.join("\n\n")}\n\n${tail}` }],
					details: { result, changes: result.changes },
				};
			}

			return {
				content: [{ type: "text", text: result.summaries.join("\n") }],
				details: { result, changes: result.changes },
			};
		},
		renderCall(args, theme, context) {
			if (!context.argsComplete) {
				return new Text(theme.fg("toolTitle", theme.bold("apply_patch: Patching")), 0, 0);
			}

			const normalizedArgs = normalizeApplyPatchArguments(args);
			const renderState = getApplyPatchRenderState(context.toolCallId, context.cwd, normalizedArgs.input);
			const text = renderState.callText.length > 0 ? `apply_patch: ${renderState.callText}` : "apply_patch";
			return new Text(theme.fg("toolTitle", theme.bold(text)), 0, 0);
		},
		renderResult(result, options, theme, context) {
			const component = new Container();
			const changes = result.details?.changes;
			const preview = result.details?.preview;

			// Final (settled) result: render from Codex-style changes when available.
			if (changes && !options.isPartial) {
				const bgName = "toolSuccessBg";
				const box = new Box(1, 1, (text: string) => applyLayeredBackground(theme, bgName, text));
				box.addChild(new Text(theme.fg("toolTitle", theme.bold("Applied patch")), 0, 0));
				box.addChild(new Spacer(1));
				box.addChild(
					new Text(formatApplyPatchChanges(changes, context.cwd, options.expanded ?? true, theme), 0, 0),
				);
				component.addChild(box);
				return component;
			}

			// Streaming / partial result: render from preview (full-file diff with line numbers).
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
				component.addChild(new Text(theme.fg("toolOutput", text), 0, 0));
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
