import type { SessionEntry } from "@pichamber/shared";

export type ConversationTurn = SessionEntry[];

type MessageValue = {
  content?: unknown;
  output?: unknown;
  command?: unknown;
  summary?: unknown;
};

const hiddenEntryTypes = new Set<SessionEntry["type"]>([
  "label",
  "model_change",
  "session_info",
  "thinking_level_change",
]);

export const messageRole = (entry: SessionEntry) =>
  entry.type === "message" ? entry.message.role : undefined;

const messageValue = (entry: SessionEntry): MessageValue | undefined =>
  entry.type === "message" ? (entry.message as MessageValue) : undefined;

export const isUserMessage = (entry: SessionEntry) => messageRole(entry) === "user";

export const isAssistantMessage = (entry: SessionEntry) => messageRole(entry) === "assistant";

export const isToolMessage = (entry: SessionEntry) => {
  const role = messageRole(entry);
  return role === "toolResult" || role === "bashExecution";
};

export const groupConversationEntries = (entries: SessionEntry[]): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  let turn: ConversationTurn = [];

  for (const entry of entries) {
    if (hiddenEntryTypes.has(entry.type)) continue;
    if (isUserMessage(entry) && turn.length > 0) {
      turns.push(turn);
      turn = [];
    }
    turn.push(entry);
  }
  if (turn.length > 0) turns.push(turn);
  return turns;
};

export const textFromContent = (content: unknown) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return String(part ?? "");
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
};

export const entryText = (entry: SessionEntry) => {
  if (entry.type === "message") {
    const message = messageValue(entry);
    return textFromContent(message?.content) || String(message?.output ?? message?.summary ?? "");
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") return entry.summary;
  if (entry.type === "custom_message") return textFromContent(entry.content);
  return "";
};

export const thinkingText = (entry: SessionEntry) => {
  const content = messageValue(entry)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as { type?: unknown; thinking?: unknown };
      return value.type === "thinking" && typeof value.thinking === "string" ? value.thinking : "";
    })
    .filter(Boolean)
    .join("\n\n");
};

export const toolCallText = (entry: SessionEntry) => {
  const content = messageValue(entry)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as { type?: unknown; name?: unknown; arguments?: unknown };
      if (value.type !== "toolCall") return "";
      const argumentsText = value.arguments === undefined ? "" : ` ${JSON.stringify(value.arguments)}`;
      return `${String(value.name ?? "tool")}${argumentsText}`;
    })
    .filter(Boolean)
    .join("\n");
};

export const entryLabel = (entry: SessionEntry) => {
  if (isUserMessage(entry)) return "You";
  if (isAssistantMessage(entry)) return "Assistant";
  if (messageRole(entry) === "bashExecution") return "Terminal";
  if (messageRole(entry) === "toolResult") return "Tool result";
  if (entry.type === "message") return "Message";
  return entry.type.replaceAll("_", " ");
};

export const activitySummary = (entry: SessionEntry) => {
  if (entry.type === "compaction") return "Conversation compacted";
  if (entry.type === "branch_summary") return "Branch summary";
  if (entry.type === "custom_message" || entry.type === "custom") return entry.customType;
  return entryLabel(entry);
};

export const previewText = (text: string, limit = 112) => {
  const singleLine = text.replaceAll(/\s+/g, " ").trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit).trimEnd()}...` : singleLine;
};

export const toolPreview = (entry: SessionEntry, text = entryText(entry)) => {
  const command = messageValue(entry)?.command;
  return typeof command === "string" ? command : text;
};

export const modelForEntry = (entries: SessionEntry[], entry: SessionEntry) => {
  for (let index = entries.indexOf(entry); index >= 0; index -= 1) {
    const candidate = entries[index];
    if (candidate?.type === "model_change") return candidate.modelId;
  }
  return "Assistant";
};

export const formatTimestamp = (timestamp: string) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(timestamp),
  );
