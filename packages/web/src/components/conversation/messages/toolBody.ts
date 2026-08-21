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
  | { kind: "grep"; output: string }
  | { kind: "paths"; output: string }
  | { kind: "text"; content: string };

type BodyInput = {
  toolName: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  /** Image attachments from the toolResult message (read tool, image files). */
  images?: ToolImage[];
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
  // Structured lists (ls/grep/find) pass the raw output through; the parse
  // + list rendering is owned by `<ToolBodyView>` (see ToolBodyView.tsx).
  // ls 与 find 渲染方式相同，共用一个流式 "paths" 列表；grep 因输出是
  // <path>:<line>:<text> 结构，仍走独立的 "grep" 解析。
  if (toolName === "ls" || toolName === "find") return { kind: "paths", output };
  if (toolName === "grep") return { kind: "grep", output };

  // 未知工具：保持简单 — 输出按纯文本展示，由调用方按需扩展注册表。
  return { kind: "text", content: output };
};
