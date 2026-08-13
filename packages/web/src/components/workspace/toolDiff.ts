/**
 * 从工具调用的参数构造 unified diff 文本（供 DiffView 渲染真实编辑内容）。
 *
 * 工具结果消息只带摘要文本（edit 的 "Successfully replaced 1 block(s)…"），
 * 实际改动在参数里：
 * - edit：args.edits[].oldText/newText
 * - write：args.content（全量新增）
 *
 * 注：apply_patch 的 diff 渲染已放弃（多文件解析不理想），此处只保留它的
 * 操作摘要解析（patchOpsSummary 供预览行用）；转 unified diff 的完整实现
 * 在 git 历史 4239fc6 之前的版本里，需要时可找回。
 */

import { workspace } from "@/stores/workspace";
import { stripParent } from "@pichamber/shared";

/** Strip the workspace prefix so in-workspace files read as relative paths.
 *  Cross-platform: a Windows cwd (`C:\Users\foo`) strips off both `\` and
 *  `/` children, so tool result rows look the same on either OS. */
export const displayPath = (path: string): string => {
  const cwd = workspace.cwd;
  return cwd ? stripParent(cwd, path) ?? path : path;
};

type Args = Record<string, unknown> | undefined;

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
  | { kind: "sep" }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string }
  | { kind: "ctx"; text: string };
type PatchOp = {
  type: "add" | "delete" | "update";
  path: string;
  moveTo?: string;
  lines: PatchLine[];
};

/** 解析 Codex 风格 apply_patch 文本（pi-apply-patch 扩展的语法）。 */
const parseApplyPatch = (input: string): PatchOp[] | undefined => {
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
      current.lines.push({ kind: "sep" });
    } else if (line.startsWith("+")) {
      current.lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ kind: "del", text: line.slice(1) });
    } else {
      current.lines.push({ kind: "ctx", text: line });
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
