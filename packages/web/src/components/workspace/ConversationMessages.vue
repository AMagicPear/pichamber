<script setup lang="ts">
import type { SessionEntry } from "@pichamber/shared";

defineProps<{
  entries: SessionEntry[];
}>();

const textFromContent = (content: unknown) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return String(part ?? "");
      const value = part as { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown; arguments?: unknown };
      if (value.type === "text" && typeof value.text === "string") return value.text;
      if (value.type === "thinking" && typeof value.thinking === "string") return value.thinking;
      if (value.type === "toolCall") {
        const argumentsText = value.arguments ? ` ${JSON.stringify(value.arguments)}` : "";
        return `${String(value.name ?? "tool")}${argumentsText}`;
      }
      return `[${String(value.type ?? "content")}]`;
    })
    .filter(Boolean)
    .join("\n\n");
};

const messageRole = (entry: SessionEntry) =>
  entry.type === "message" ? entry.message.role : undefined;

const entryLabel = (entry: SessionEntry) => {
  if (entry.type === "message") return messageRole(entry) ?? "message";
  if (entry.type === "thinking_level_change") return "thinking level";
  if (entry.type === "model_change") return "model changed";
  if (entry.type === "session_info") return "session info";
  return entry.type.replaceAll("_", " ");
};

const entryText = (entry: SessionEntry) => {
  if (entry.type === "message") {
    const message = entry.message as { content?: unknown; output?: unknown; command?: unknown };
    return textFromContent(message.content) || String(message.output ?? message.command ?? "");
  }
  if (entry.type === "thinking_level_change") return entry.thinkingLevel;
  if (entry.type === "model_change") return `${entry.provider} / ${entry.modelId}`;
  if (entry.type === "compaction" || entry.type === "branch_summary") return entry.summary;
  if (entry.type === "custom_message") return textFromContent(entry.content);
  if (entry.type === "session_info") return entry.name ?? "";
  if (entry.type === "label") return entry.label ?? "Label removed";
  if (entry.type === "custom") return entry.customType;
  return "";
};

const entryClass = (entry: SessionEntry) => [
  "conversation-entry",
  `conversation-entry--${entry.type}`,
  ...(messageRole(entry) ? [`conversation-entry--${messageRole(entry)}`] : []),
];

const formatTimestamp = (timestamp: string) =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(timestamp),
  );
</script>

<template>
  <div class="conversation__messages">
    <article v-for="entry in entries" :key="entry.id" :class="entryClass(entry)">
      <header class="conversation-entry__header">
        <span class="conversation-entry__type">{{ entryLabel(entry) }}</span>
        <time :datetime="entry.timestamp">{{ formatTimestamp(entry.timestamp) }}</time>
      </header>
      <pre v-if="entryText(entry)" class="conversation-entry__content">{{ entryText(entry) }}</pre>
      <details class="conversation-entry__details">
        <summary>Details</summary>
        <pre>{{ JSON.stringify(entry, null, 2) }}</pre>
      </details>
    </article>
  </div>
</template>

<style scoped>
.conversation__messages {
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 24px 16px 24px;
}
.conversation-entry {
  margin: 0 0 8px;
  padding: 12px 14px;
  border: 1px solid #dfddd5;
  border-radius: 6px;
  background: #fff;
}
.conversation-entry--user {
  border-color: #b9d4ca;
  background: #f3faf6;
}
.conversation-entry--assistant {
  background: #fcfcfb;
}
.conversation-entry__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #76746d;
  font-size: 11px;
  line-height: 16px;
  text-transform: uppercase;
}
.conversation-entry__type {
  color: #45433e;
  font-weight: 600;
}
.conversation-entry__header time {
  flex: none;
}
.conversation-entry__content,
.conversation-entry__details pre {
  margin: 8px 0 0;
  color: #292827;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.conversation-entry__details {
  margin-top: 8px;
  color: #76746d;
  font-size: 12px;
}
.conversation-entry__details summary {
  cursor: pointer;
}
.conversation-entry__details pre {
  padding: 10px;
  overflow-x: auto;
  border-radius: 4px;
  background: #f5f4f0;
  color: #4d4b45;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
}
</style>
