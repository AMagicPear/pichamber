/**
 * Content extraction from pi messages. Messages carry `content` as either a
 * string or an array of typed parts (text / thinking / toolCall / image…);
 * these helpers pick the parts a given surface renders.
 */
import type { AgentMessage } from "@pichamber/shared";

type ContentPart = { type?: unknown; [key: string]: unknown } | string;

const partsOf = (message?: AgentMessage): ContentPart[] => {
  const content = message as { content?: unknown } | undefined;
  return Array.isArray(content?.content) ? (content.content as ContentPart[]) : [];
};

const textOf = (part: ContentPart): string =>
  typeof part === "object" && part?.type === "text" && typeof part.text === "string"
    ? part.text
    : "";

/** Concatenated text parts (what MarkdownRender renders). */
export const messageText = (message?: AgentMessage): string => {
  const content = message as { content?: unknown } | undefined;
  if (typeof content?.content === "string") return content.content;
  return partsOf(message)
    .map(textOf)
    .filter(Boolean)
    .join("\n\n");
};

/** 工具执行结果（live 阶段的 partialResult / 结束 result）是 pi 的
 *  `{content, details}` 封套，结构与 message 相同，取文本直接复用
 *  messageText；字符串结果原样返回；只有未知形状才退回 JSON（便于排查
 *  新工具时看到原始结构）。空 content（如 bash 启动时的占位更新）返回
 *  空串——不把封套本身显示出来。 */
export const toolResultText = (result: unknown): string => {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if ("content" in record) return messageText(result as AgentMessage);
    return JSON.stringify(result, null, 2);
  }
  return "";
};

/** Concatenated thinking parts (collapsed behind a "Thinking" detail). */export const thinkingText = (message?: AgentMessage): string =>
  partsOf(message)
    .map((part) =>
      typeof part === "object" && part?.type === "thinking" && typeof part.thinking === "string"
        ? part.thinking
        : "",
    )
    .filter(Boolean)
    .join("\n\n");

/** Image parts (attachments / read-tool results), rendered as thumbnails. */
export const messageImages = (message?: AgentMessage): Array<{ data: string; mimeType: string }> =>
  partsOf(message).flatMap((part) =>
    typeof part === "object" &&
    part?.type === "image" &&
    typeof part.data === "string" &&
    typeof part.mimeType === "string"
      ? [{ data: part.data, mimeType: part.mimeType }]
      : [],
  );

/** True while the model is still streaming into a thinking part: the last
 *  content part is `thinking` (pi appends deltas to the last part in stream
 *  order). Drives the Thinking detail's auto expand/collapse. */
export const thinkingStreaming = (message?: AgentMessage, final = false): boolean => {
  if (final) return false;
  const parts = partsOf(message);
  if (parts.length === 0) return false;
  const last = parts[parts.length - 1];
  return typeof last === "object" && last !== null && last?.type === "thinking";
};

/** Collapse whitespace for single-line previews. */
export const inline = (value: string): string => value.replace(/\s+/g, " ").trim();
