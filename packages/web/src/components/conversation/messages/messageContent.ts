/**
 * Content extraction from pi messages. Messages carry `content` as either a
 * string or an array of typed parts (text / thinking / toolCall / image…);
 * these helpers pick the parts a given surface renders.
 */
import type { AgentMessage } from "@amagicpear/pichamber-shared";

type ContentPart = { type?: unknown; [key: string]: unknown } | string;

/** AgentMessage 是联合类型，并非每个变体都有 content（bashExecution /
 *  branchSummary 等自定义角色没有该字段），统一经宽松类型读取。 */
const contentOf = (message?: AgentMessage): unknown =>
  (message as { content?: unknown } | undefined)?.content;

const partsOf = (content: unknown): ContentPart[] =>
  Array.isArray(content) ? (content as ContentPart[]) : [];

const textOf = (part: ContentPart): string =>
  typeof part === "object" && part?.type === "text" && typeof part.text === "string"
    ? part.text
    : "";

/** Concatenated text parts (what MarkdownRender renders). */
export const messageText = (message?: AgentMessage): string => {
  const content = contentOf(message);
  if (typeof content === "string") return content;
  return partsOf(content).map(textOf).filter(Boolean).join("\n\n");
};

/** 工具结果（live 的 partialResult / 结束 result）是 `{content, details}`
 *  封套，与 message 同构，取文本直接复用 messageText；字符串原样返回；
 *  未知形状退回 JSON 便于排查；空 content（bash 启动占位）返回空串。 */
export const toolResultText = (result: unknown): string => {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if ("content" in record) return messageText(result as AgentMessage);
    return JSON.stringify(result, null, 2);
  }
  return "";
};

/** Concatenated thinking parts (collapsed behind a "Thinking" detail). */
export const thinkingText = (message?: AgentMessage): string =>
  partsOf(contentOf(message))
    .map((part) =>
      typeof part === "object" && part?.type === "thinking" && typeof part.thinking === "string"
        ? part.thinking
        : "",
    )
    .filter(Boolean)
    .join("\n\n");

/** Image parts (attachments / read-tool results), rendered as thumbnails. */
export const messageImages = (message?: AgentMessage): Array<{ data: string; mimeType: string }> =>
  partsOf(contentOf(message)).flatMap((part) =>
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
  const last = partsOf(contentOf(message)).at(-1);
  return typeof last === "object" && last?.type === "thinking";
};

/** Collapse whitespace for single-line previews. */
export const inline = (value: string): string => value.replace(/\s+/g, " ").trim();

/** Pulls the server-assigned `timestamp` (ms epoch) off a pi message —
 *  every message type carries one — and renders it as a short local
 *  string suitable for both user-side footers and assistant-side
 *  inline timestamps. Returns undefined when the field is missing or
 *  malformed so the caller can omit the row entirely. */
export const messageTimestampText = (message: AgentMessage | undefined): string | undefined => {
  if (!message) return undefined;
  const ts = (message as { timestamp?: unknown }).timestamp;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return undefined;
  return new Date(ts).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
};
