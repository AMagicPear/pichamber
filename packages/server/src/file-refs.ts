/**
 * Expand `@path` references in user messages, mirroring pi's native
 * behavior (its CLI expands `@files` into `<file>` blocks + image
 * attachments before sending — see dist/cli/file-processor.js; the
 * interactive TUI applies the same expansion to typed @mentions).
 *
 * - Image files (sniffed by magic bytes, like pi's mime.ts) become
 *   ImageContent attachments; the `@path` token is replaced with an
 *   empty `<file>` block, exactly like the CLI does.
 * - Other files are decoded as UTF-8 into a truncated `<file>` block.
 * - Unresolvable / out-of-workspace / oversized references stay as-is
 *   so the model can decide what to do with them.
 */
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";

import { isWithinWorkspace } from "./workspace";

/** 单文件展开上限（原始字节）。 */
const MAX_EXPAND_BYTES = 200 * 1024;
/** 文本文件最多展开的行数，超出截断并注明。 */
const MAX_EXPAND_LINES = 400;
/** 图片附件原始字节上限（不做 resize，超限直接省略）。 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** `@path` or `@"path with spaces"`; `m[1]` is the character before the
 *  token (kept), `m[3]` the quoted form, `m[4]` the bare form. The bare
 *  form allows dots (file names) but stops at whitespace and closing
 *  brackets; trailing punctuation is stripped when resolving. */
const FILE_REF_RE = /(^|[^\w@])@("([^"]*)"|([^\s)\]}>，。；：！？]+))/g;
/** 句子结尾标点（中英），resolve 前剥掉。 */
const TRAILING_PUNCT = /[.,;:!?，。；：！？]+$/;

const stripTrailingPunct = (ref: string): string => ref.replace(TRAILING_PUNCT, "");

/** 魔数嗅探（与 pi 的 detectSupportedImageMimeType 同一套签名）。 */
const detectImageMimeType = (buffer: Buffer): string | null => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return buffer[3] === 0xf7 ? null : "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer.toString("ascii", 0, 2) === "BM") return "image/bmp";
  return null;
};

/** `<file name>` 标签内的名字转义，防止文件名破坏块结构。 */
const escapeTag = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Expand one `@path` reference into the pi CLI `<file>` block format.
 * Returns null when the reference can't be expanded (missing, outside the
 * workspace, empty, or too large) — the caller then keeps the token as-is.
 */
const expandRef = async (
  ref: string,
  cwd: string,
): Promise<{ replacement: string; images: ImageContent[] } | null> => {
  const absolutePath = isAbsolute(ref) ? ref : resolve(cwd, ref);
  // 路径解析后仍在 workspace 内才展开（home 目录即 workspace，天然覆盖
  // 会话 cwd 之外的常见引用）。
  if (!isWithinWorkspace(absolutePath)) return null;
  try {
    await access(absolutePath);
    const stats = await stat(absolutePath);
    if (!stats.isFile() || stats.size === 0) return null;
    const buffer = await readFile(absolutePath);

    const mimeType = detectImageMimeType(buffer);
    if (mimeType) {
      if (buffer.length > MAX_IMAGE_BYTES) {
        return { replacement: `<file name="${escapeTag(absolutePath)}">[Image omitted: exceeds size limit]</file>`, images: [] };
      }
      return {
        replacement: `<file name="${escapeTag(absolutePath)}"></file>`,
        images: [{ type: "image", data: buffer.toString("base64"), mimeType }],
      };
    }

    if (buffer.length > MAX_EXPAND_BYTES) {
      return { replacement: `<file name="${escapeTag(absolutePath)}">[File omitted: exceeds ${MAX_EXPAND_BYTES / 1024}KB limit]</file>`, images: [] };
    }
    const text = buffer.toString("utf-8");
    const lines = text.split("\n");
    const body =
      lines.length <= MAX_EXPAND_LINES
        ? text
        : `${lines.slice(0, MAX_EXPAND_LINES).join("\n")}\n... (${lines.length - MAX_EXPAND_LINES} more lines, truncated)`;
    return { replacement: `<file name="${escapeTag(absolutePath)}">\n${body}\n</file>`, images: [] };
  } catch {
    // 不存在/不可读：原样保留引用。
    return null;
  }
};

/**
 * Expand every `@path` reference in a message. Unresolvable references are
 * left untouched; the workspace variable is read at call time so tests can
 * swap it.
 */
export const expandFileRefs = async (text: string, cwd: string): Promise<{ text: string; images: ImageContent[] }> => {
  const images: ImageContent[] = [];
  const matches = [...text.matchAll(FILE_REF_RE)];
  if (matches.length === 0) return { text, images };
  const expanded: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    // 裸形式剥掉句子结尾标点（"看图 @a.png。" → a.png），引号形式原样。
    const ref = match[3] ?? stripTrailingPunct(match[4] ?? "");
    if (!ref) continue;
    const result = await expandRef(ref, cwd);
    if (!result) continue;
    // 前缀字符（m[1]）保留，@token 整体替换为展开块。
    expanded.push(text.slice(cursor, match.index!));
    expanded.push(match[1] ?? "");
    expanded.push(result.replacement);
    images.push(...result.images);
    cursor = match.index! + match[0].length;
  }
  if (cursor === 0) return { text, images };
  expanded.push(text.slice(cursor));
  return { text: expanded.join(""), images };
};
