<script setup lang="ts">
import { computed, watch } from "vue";
import MarkdownRender from "markstream-vue";
import type { SessionEntry } from "@pichamber/shared";
import BrainIcon from "@/assets/icons/Brain.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";

const props = defineProps<{
  entries: SessionEntry[];
}>();

const visibleEntries = computed(() =>
  props.entries.filter(
    (entry) =>
      entry.type !== "model_change" &&
      entry.type !== "thinking_level_change" &&
      entry.type !== "session_info" &&
      entry.type !== "label",
  ),
);

const turns = computed(() => {
  const result: SessionEntry[][] = [];
  let turn: SessionEntry[] = [];

  for (const entry of visibleEntries.value) {
    if (isUserMessage(entry) && turn.length > 0) {
      result.push(turn);
      turn = [];
    }
    turn.push(entry);
  }
  if (turn.length > 0) result.push(turn);
  return result;
});

watch(
  () => props.entries,
  (entries) => {
    if (entries.length > 0) {
      console.log("[conversation] loaded SessionEntry[]", JSON.parse(JSON.stringify(entries)));
    }
  },
  { immediate: true },
);

const textFromContent = (content: unknown) => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return String(part ?? "");
      const value = part as { type?: unknown; text?: unknown };
      if (value.type === "text" && typeof value.text === "string") return value.text;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
};

const messageRole = (entry: SessionEntry) =>
  entry.type === "message" ? entry.message.role : undefined;

const messageValue = (entry: SessionEntry) =>
  entry.type === "message"
    ? (entry.message as { content?: unknown; output?: unknown; command?: unknown; summary?: unknown })
    : undefined;

const isUserMessage = (entry: SessionEntry) => messageRole(entry) === "user";
const isAssistantMessage = (entry: SessionEntry) => messageRole(entry) === "assistant";
const isToolMessage = (entry: SessionEntry) => {
  const role = messageRole(entry);
  return role === "toolResult" || role === "bashExecution";
};

const userEntry = (turn: SessionEntry[]) => turn.find(isUserMessage);
const agentEntries = (turn: SessionEntry[]) => turn.filter((entry) => !isUserMessage(entry));
const firstAssistantEntry = (turn: SessionEntry[]) => turn.find(isAssistantMessage);

const thinkingText = (entry: SessionEntry) => {
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

const toolCallText = (entry: SessionEntry) => {
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

const entryLabel = (entry: SessionEntry) => {
  if (isUserMessage(entry)) return "You";
  if (isAssistantMessage(entry)) return "Assistant";
  if (messageRole(entry) === "bashExecution") return "Terminal";
  if (messageRole(entry) === "toolResult") return "Tool result";
  if (entry.type === "message") return "Message";
  if (entry.type === "thinking_level_change") return "thinking level";
  if (entry.type === "model_change") return "model changed";
  if (entry.type === "session_info") return "session info";
  return entry.type.replaceAll("_", " ");
};

const entryText = (entry: SessionEntry) => {
  if (entry.type === "message") {
    const message = messageValue(entry);
    return textFromContent(message?.content) || String(message?.output ?? message?.summary ?? "");
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") return entry.summary;
  if (entry.type === "custom_message") return textFromContent(entry.content);
  return "";
};

const activitySummary = (entry: SessionEntry) => {
  if (entry.type === "thinking_level_change") return `Thinking: ${entry.thinkingLevel}`;
  if (entry.type === "model_change") return `Model: ${entry.provider} / ${entry.modelId}`;
  if (entry.type === "compaction") return "Conversation compacted";
  if (entry.type === "branch_summary") return "Branch summary";
  if (entry.type === "session_info") return entry.name ? `Session renamed: ${entry.name}` : "Session info updated";
  if (entry.type === "label") return entry.label ?? "Label removed";
  if (entry.type === "custom_message") return entry.customType;
  if (entry.type === "custom") return entry.customType;
  return entryLabel(entry);
};

const previewText = (text: string, limit = 112) => {
  const singleLine = text.replaceAll(/\s+/g, " ").trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit).trimEnd()}...` : singleLine;
};

const toolPreview = (entry: SessionEntry) => {
  const message = messageValue(entry);
  return typeof message?.command === "string" ? message.command : entryText(entry);
};

const modelForEntry = (entry: SessionEntry) => {
  for (let index = props.entries.indexOf(entry); index >= 0; index -= 1) {
    const candidate = props.entries[index];
    if (candidate?.type === "model_change") return candidate.modelId;
  }
  return "Assistant";
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
    <template v-for="(turn, index) in turns" :key="turn.at(-1)?.id ?? index">
      <article v-if="userEntry(turn)" class="conversation-entry conversation-entry--user">
        <pre class="conversation-entry__content">{{ entryText(userEntry(turn)!) }}</pre>
      </article>

      <section v-if="agentEntries(turn).length > 0" class="conversation-turn">
        <header v-if="firstAssistantEntry(turn)" class="conversation-entry__header">
        <span class="conversation-entry__author">
          <BrainIcon />
          <span class="conversation-entry__type">{{ modelForEntry(firstAssistantEntry(turn)!) }}</span>
        </span>
        </header>
        <template v-for="entry in agentEntries(turn)" :key="entry.id">
          <details v-if="isAssistantMessage(entry) && thinkingText(entry)" class="conversation-entry__reasoning">
            <summary>
              <BrainIcon />
              <strong>Thinking</strong>
              <span>{{ previewText(thinkingText(entry)) }}</span>
            </summary>
            <pre>{{ thinkingText(entry) }}</pre>
          </details>
          <MarkdownRender v-if="isAssistantMessage(entry) && entryText(entry)" class="conversation-entry__content" mode="chat" :content="entryText(entry)" :final="true" :fade="false" />
          <details v-if="isAssistantMessage(entry) && toolCallText(entry)" class="conversation-entry__tool">
            <summary>
              <TerminalIcon />
              <strong>Tool call</strong>
              <span>{{ previewText(toolCallText(entry)) }}</span>
            </summary>
            <pre>{{ toolCallText(entry) }}</pre>
          </details>
          <details v-else-if="isToolMessage(entry)" class="conversation-entry__tool">
            <summary>
              <TerminalIcon />
              <strong>{{ entryLabel(entry) }}</strong>
              <span>{{ previewText(toolPreview(entry)) }}</span>
            </summary>
            <pre v-if="entryText(entry)">{{ entryText(entry) }}</pre>
          </details>
          <details v-else-if="!isAssistantMessage(entry)" class="conversation-activity">
            <summary>
              <span>{{ activitySummary(entry) }}</span>
              <time :datetime="entry.timestamp">{{ formatTimestamp(entry.timestamp) }}</time>
            </summary>
            <pre v-if="entryText(entry)" class="conversation-activity__content">{{ entryText(entry) }}</pre>
          </details>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.conversation__messages {
  flex: 1;
  align-self: stretch;
  width: 100%;
  max-width: 56rem;
  min-width: 0;
  margin-inline: auto;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 0 16px;
}
.conversation-entry {
  width: 100%;
  max-width: 48rem;
  min-width: 0;
  margin: 0 auto;
  padding: 24px clamp(12px, 2.5vw, 16px) 0;
  color: #292827;
}
.conversation-entry--user {
  width: fit-content;
  max-width: 85%;
  min-width: 0;
  margin-left: auto;
  margin-right: 0;
  padding: 12px 20px;
  border: 1px solid #ece9e0;
  border-radius: 12px 12px 4px;
  background: #f7f6f2;
}
.conversation-turn {
  width: 100%;
  max-width: 48rem;
  min-width: 0;
  margin: 0 auto;
  padding: 24px clamp(12px, 2.5vw, 16px) 32px;
  color: #292827;
}
.conversation-entry__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #45433e;
  font-size: 14px;
  line-height: 18px;
}
.conversation-entry--user .conversation-entry__header {
  display: none;
}
.conversation-entry__type {
  font-weight: 700;
}
.conversation-entry__author {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.conversation-entry__author svg {
  width: 18px;
  height: 18px;
}
.conversation-entry__header time {
  flex: none;
  color: #76746d;
  font-size: 12px;
  font-weight: 400;
}
.conversation-entry__content {
  margin: 0;
  color: #292827;
  font-family: inherit;
  font-size: 15px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.conversation-entry__content:deep(.node-slot:first-child .paragraph-node) {
  margin-top: 0;
}
.conversation-entry__content:deep(.node-slot:last-child .paragraph-node) {
  margin-bottom: 0;
}
.conversation-entry__content:deep(.paragraph-node) {
  margin-block: 0 8px;
}
.conversation-entry__content:deep(ul),
.conversation-entry__content:deep(ol) {
  margin-block: 6px 8px;
}
.conversation-entry__content:deep(p + p),
.conversation-entry__content:deep(p + ul),
.conversation-entry__content:deep(p + ol),
.conversation-entry__content:deep(ul + p),
.conversation-entry__content:deep(ol + p) {
  margin-top: 0;
}
.conversation-entry__content:deep(.node-slot:last-child .paragraph-node),
.conversation-entry__content:deep(.node-slot:last-child ul),
.conversation-entry__content:deep(.node-slot:last-child ol) {
  margin-bottom: 0;
}
.conversation-turn > .conversation-entry__content {
  margin-bottom: 14px;
}
.conversation-entry__reasoning {
  margin: 0 0 12px;
  padding: 0;
  color: #76746d;
  font-size: 13px;
}
.conversation-entry__tool {
  margin: 0 0 14px;
  padding: 0;
  color: #76746d;
  font-size: 13px;
}
.conversation-entry__reasoning summary,
.conversation-entry__tool > summary {
  display: grid;
  grid-template-columns: 16px max-content minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  list-style: none;
  cursor: pointer;
  line-height: 20px;
}
.conversation-entry__reasoning summary::-webkit-details-marker,
.conversation-entry__tool > summary::-webkit-details-marker {
  display: none;
}
.conversation-entry__reasoning summary svg,
.conversation-entry__tool > summary svg {
  width: 16px;
  height: 16px;
}
.conversation-entry__reasoning summary strong,
.conversation-entry__tool > summary strong {
  color: #292827;
  font-weight: 650;
}
.conversation-entry__reasoning summary span,
.conversation-entry__tool > summary span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-entry__reasoning pre,
.conversation-entry__tool > pre {
  margin: 6px 0 0 23px;
  color: #4d4b45;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.conversation-entry__tool > summary {
  grid-template-columns: 16px max-content minmax(0, 1fr);
}
.conversation-entry__tool time,
.conversation-activity time {
  flex: none;
  color: #8a8881;
  font-size: 12px;
  font-weight: 400;
}
.conversation-activity {
  display: block;
  margin: 10px 0 0;
  padding: 0;
  color: #76746d;
  font-size: 13px;
}
.conversation-activity > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.conversation-activity__content {
  margin: 10px 0 0;
  padding-left: 12px;
  border-left: 2px solid #dfddd5;
  color: #4d4b45;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (min-width: 1024px) {
  .conversation-entry {
    padding-right: clamp(16px, 2.5vw, 24px);
    padding-left: clamp(16px, 2.5vw, 24px);
  }
  .conversation-turn {
    padding-right: clamp(16px, 2.5vw, 24px);
    padding-left: clamp(16px, 2.5vw, 24px);
  }
  .conversation-activity {
    padding: 0;
  }
}
</style>
