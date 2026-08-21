/**
 * 从工具调用的参数构造 unified diff 文本（供 DiffView 渲染真实编辑内容）。
 *
 * 工具结果消息只带摘要文本（edit 的 "Successfully replaced 1 block(s)…"），
 * 实际改动在参数里：
 * - edit：args.edits[].oldText/newText
 * - write：args.content（全量新增）
 *
 * apply_patch 也在这里解析和转换，保证所有 diff 输入都走同一个出口。
 */

import { workspace } from "@/stores/workspace";

/** Strip the workspace prefix so in-workspace files read as relative paths. */
export const displayPath = (path: string): string => {
  const cwd = workspace.cwd;
  return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
};

type Args = Record<string, unknown> | undefined;

export const stringArg = (args: unknown, key: "command" | "path"): string | undefined => {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const value = key === "path" ? record.path ?? record.file_path : record.command;
  return typeof value === "string" ? value : undefined;
};

export const numberArg = (args: unknown, key: string): number | undefined => {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const isFileTool = (toolName: string) =>
  toolName === "read" || toolName === "write" || toolName === "edit";

const asLines = (text: string): string[] => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

const hunk = (oldStart: number, oldCount: number, newStart: number, newCount: number) =>
  `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;

const sameLines = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

/** edit 工具：逐块 oldText → newText。行号无从得知，用顺序近似（仅影响 gutter 数字）。 */
const editToolDiff = (path: string, args: Args): string | undefined => {
  if (!Array.isArray(args?.edits)) return undefined;
  const out: string[] = [];
  let oldStart = 1;
  let newStart = 1;
  for (const block of args.edits) {
    if (!block || typeof block !== "object") continue;
    const { oldText, newText } = block as { oldText?: unknown; newText?: unknown };
    if (typeof oldText !== "string" || typeof newText !== "string") continue;
    const oldLines = asLines(oldText);
    const newLines = asLines(newText);
    if (sameLines(oldLines, newLines)) continue;
    if (out.length === 0) {
      out.push(`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`);
    }
    out.push(hunk(oldStart, oldLines.length, newStart, newLines.length));
    for (const l of oldLines) out.push(`-${l}`);
    for (const l of newLines) out.push(`+${l}`);
    oldStart += oldLines.length;
    newStart += newLines.length;
  }
  return out.length > 2 ? out.join("\n") : undefined;
};

/** write 工具：全量新增。 */
const writeToolDiff = (path: string, args: Args): string | undefined => {
  const content = args?.content;
  if (typeof content !== "string") return undefined;
  const lines = asLines(content);
  return [
    `diff --git a/${path} b/${path}`,
    `--- /dev/null`,
    `+++ b/${path}`,
    hunk(0, 0, 1, lines.length),
    ...lines.map((l) => `+${l}`),
  ].join("\n");
};

type PatchLine =
  | { kind: "sep"; header: string }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string }
  | { kind: "ctx"; text: string };
export type PatchOp = {
  type: "add" | "delete" | "update";
  path: string;
  moveTo?: string;
  lines: PatchLine[];
};

/** 解析 Codex 风格 apply_patch 文本（pi-apply-patch 扩展的语法）。 */
export const parseApplyPatch = (input: string): PatchOp[] | undefined => {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "*** Begin Patch") return undefined;
  const ops: PatchOp[] = [];
  let current: PatchOp | undefined;
  for (const line of lines) {
    if (line.startsWith("*** ")) {
      if (line.startsWith("*** Add File: ")) {
        current = { type: "add", path: line.slice("*** Add File: ".length).trim(), lines: [] };
        ops.push(current);
      } else if (line.startsWith("*** Delete File: ")) {
        current = { type: "delete", path: line.slice("*** Delete File: ".length).trim(), lines: [] };
        ops.push(current);
      } else if (line.startsWith("*** Update File: ")) {
        current = { type: "update", path: line.slice("*** Update File: ".length).trim(), lines: [] };
        ops.push(current);
      } else if (line.startsWith("*** Move to: ") && current) {
        current.moveTo = line.slice("*** Move to: ".length).trim();
      } else if (line === "*** End Patch") {
        current = undefined;
      }
      // "*** End of File" 只是标记，内容已在前面的行里
      continue;
    }
    if (!current || current.type === "delete") continue;
    if (line === "@@" || line.startsWith("@@ ")) {
      current.lines.push({ kind: "sep", header: line });
    } else if (line.startsWith("+")) {
      current.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ kind: "del", text: line.slice(1) });
    } else {
      current.lines.push({ kind: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return ops;
};

/** apply_patch 的紧凑摘要（"add: example.txt, update: app.ts"），供预览行用。 */
export const patchOpsSummary = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const ops = parseApplyPatch(input);
  if (!ops || ops.length === 0) return undefined;
  return ops
    .map((op) => {
      const name = op.type === "add" ? "add" : op.type === "delete" ? "delete" : "update";
      return `${name}: ${op.moveTo ?? op.path}`;
    })
    .join(", ");
};

const hunkHeader = (header: string, oldStart: number, oldCount: number, newStart: number, newCount: number) =>
  header === "@@" ? `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@` : header;

/** Convert Codex apply_patch operations into a standard multi-file diff. */
export const applyPatchDiff = (input: unknown): string | undefined => {
  if (typeof input !== "string") return undefined;
  const ops = parseApplyPatch(input);
  if (!ops || ops.length === 0) return undefined;
  const parts: string[] = [];
  for (const op of ops) {
    const oldPath = displayPath(op.path);
    const newPath = displayPath(op.moveTo ?? op.path);
    const out = [`diff --git a/${oldPath} b/${newPath}`];
    if (op.type === "add") {
      const adds = op.lines.filter((line) => line.kind === "add");
      out.push("--- /dev/null", `+++ b/${newPath}`, `@@ -0,0 +1,${adds.length} @@`);
      out.push(...adds.map((line) => `+${line.text}`));
    } else if (op.type === "delete") {
      out.push(`--- a/${oldPath}`, "+++ /dev/null", "@@ -1,0 +0,0 @@");
    } else {
      out.push(`--- a/${oldPath}`, `+++ b/${newPath}`);
      let oldStart = 1;
      let newStart = 1;
      let hunk: Extract<PatchLine, { kind: "add" | "del" | "ctx" }>[] = [];
      const flushHunk = (header: string) => {
        const oldCount = hunk.filter((line) => line.kind !== "add").length;
        const newCount = hunk.filter((line) => line.kind !== "del").length;
        out.push(hunkHeader(header, oldStart, oldCount, newStart, newCount));
        out.push(
          ...hunk.map((line) =>
            line.kind === "add" ? `+${line.text}` : line.kind === "del" ? `-${line.text}` : ` ${line.text}`,
          ),
        );
        oldStart += oldCount;
        newStart += newCount;
        hunk = [];
      };
      for (const line of op.lines) {
        if (line.kind === "sep") {
          if (hunk.length > 0) flushHunk(line.header);
        } else hunk.push(line);
      }
      if (hunk.length > 0) flushHunk("@@");
    }
    parts.push(out.join("\n"));
  }
  return parts.join("\n");
};

/** 依据工具名与参数构造 diff；参数缺失/不可解析时返回 undefined（走纯文本回退）。 */
export const toolDiff = (toolName: string, args: unknown): string | undefined => {
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : undefined;
  if (toolName === "edit" && path) return editToolDiff(displayPath(path), record);
  if (toolName === "write" && path) return writeToolDiff(displayPath(path), record);
  return undefined;
};
