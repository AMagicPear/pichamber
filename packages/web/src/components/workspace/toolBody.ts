/**
 * Body rendering decision for tool results.
 *
 * Each tool picks a renderer through a single `toolBody()` entry point. The
 * returned `ToolBody` discriminator tells `<ConversationDetail>` which body
 * shape to mount (CodeView, DiffView, structured list, …). The label /
 * preview of the row still live in `conversationToolDetail.ts` — this module
 * is only about the expanded body.
 */
import { applyPatchDiff, displayPath, isFileTool, stringArg, toolDiff } from "./toolDiff";

/** 单张图片附件，data 是 base64（不含前缀），由渲染层补 data: URL。 */
export type ToolImage = { data: string; mimeType: string };

export type ToolBody =
  | { kind: "code"; content: string; fileName?: string }
  | { kind: "diff"; patch: string }
  | { kind: "images"; images: ToolImage[] }
  | { kind: "markdown"; content: string }
  | { kind: "ls"; entries: { name: string; isDir: boolean }[]; notes: string[] }
  | { kind: "grep"; matches: GrepMatch[]; notes: string[] }
  | { kind: "paths"; paths: string[]; notes: string[] }
  | { kind: "text"; content: string };

export type GrepMatch = { file: string; line: number; text: string };

type BodyInput = {
  toolName: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  /** Image attachments from the toolResult message (read tool, image files). */
  images?: ToolImage[];
};

/** Pi appends truncation/limit notices as bracketed lines like
 *  `[Truncated: 50 entries limit]`. Split them off so the structured lists
 *  show only real entries; the notes are rendered as a muted footnote. */
const splitNotes = (output: string): { lines: string[]; notes: string[] } => {
  const raw = output.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  const notes: string[] = [];
  for (const line of raw) {
    if (line.startsWith("[") && line.endsWith("]")) notes.push(line);
    else lines.push(line);
  }
  return { lines, notes };
};

const buildLsBody = (output: string): Extract<ToolBody, { kind: "ls" }> => {
  const { lines, notes } = splitNotes(output);
  const entries = lines
    .filter((l) => l.length > 0)
    .map((name) => ({ name, isDir: name.endsWith("/") }));
  return { kind: "ls", entries, notes };
};

const buildGrepBody = (output: string): Extract<ToolBody, { kind: "grep" }> => {
  const { lines, notes } = splitNotes(output);
  const matches: GrepMatch[] = [];
  for (const line of lines) {
    // ripgrep convention: <path>:<line>:<text>. The matched line can itself
    // contain ":", so split on the first two colons.
    const first = line.indexOf(":");
    if (first <= 0) continue;
    const second = line.indexOf(":", first + 1);
    if (second <= 0) continue;
    const file = displayPath(line.slice(0, first));
    const num = Number.parseInt(line.slice(first + 1, second), 10);
    if (!Number.isFinite(num)) continue;
    matches.push({ file, line: num, text: line.slice(second + 1) });
  }
  return { kind: "grep", matches, notes };
};

const buildPathsBody = (output: string): Extract<ToolBody, { kind: "paths" }> => {
  const { lines, notes } = splitNotes(output);
  return { kind: "paths", paths: lines.filter((p) => p.length > 0).map(displayPath), notes };
};

/** Decide which body renderer to use for a given tool. Returns one of the
 *  `ToolBody` shapes; the caller passes it straight to `<ConversationDetail>`. */
export const toolBody = ({
  toolName,
  args,
  output,
  isError,
  images,
}: BodyInput): ToolBody => {
  const failed = isError === true;
  const path = stringArg(args, "path");

  if (isFileTool(toolName) && path) {
    const relative = displayPath(path);
    // read 工具读取图片时，结果里只有 "Read image file [mime]" 这行占位文字，
    // 真正的图在 image part 里。检测到图片附件时不要把占位文字当文件内容渲染。
    const hasImages = !failed && toolName === "read" && !!images && images.length > 0;
    if (hasImages) return { kind: "images", images: images! };
    // write/edit 用 args 里的真实编辑内容构造 diff，让 DiffView 渲染。
    if (!failed) {
      const patch = toolDiff(toolName, args);
      if (patch) return { kind: "diff", patch };
    }
    // read 成功 → 文件视图（行号 + 高亮）；其它情况降级为纯文本。
    if (!failed && toolName === "read") return { kind: "code", content: output, fileName: relative };
    return { kind: "text", content: output };
  }

  if (toolName === "apply_patch") {
    const patch = applyPatchDiff((args as { input?: unknown }).input);
    if (!failed && patch) return { kind: "diff", patch };
    return { kind: "text", content: output };
  }

  if (toolName === "bash") return { kind: "text", content: output };
  if (toolName === "ls") return buildLsBody(output);
  if (toolName === "grep") return buildGrepBody(output);
  if (toolName === "find") return buildPathsBody(output);

  // 未知工具：保持简单 — 输出按纯文本展示，由调用方按需扩展注册表。
  return { kind: "text", content: output };
};
