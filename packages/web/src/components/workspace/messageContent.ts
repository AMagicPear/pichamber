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

/** Concatenated thinking parts (collapsed behind a "Thinking" detail). */
export const thinkingText = (message?: AgentMessage): string =>
  partsOf(message)
    .map((part) =>
      typeof part === "object" && part?.type === "thinking" && typeof part.thinking === "string"
        ? part.thinking
        : "",
    )
    .filter(Boolean)
    .join("\n\n");

/** Collapse whitespace for single-line previews. */
export const inline = (value: string): string => value.replace(/\s+/g, " ").trim();
