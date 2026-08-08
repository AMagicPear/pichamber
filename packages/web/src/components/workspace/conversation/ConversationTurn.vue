<script setup lang="ts">
import { computed } from "vue";
import MarkdownRender from "markstream-vue";
import type { SessionEntry } from "@pichamber/shared";
import BrainIcon from "@/assets/icons/Brain.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
import {
  activitySummary,
  entryLabel,
  entryText,
  formatTimestamp,
  isAssistantMessage,
  isToolMessage,
  isUserMessage,
  modelForEntry,
  previewText,
  thinkingText,
  toolCallText,
  toolPreview,
  type ConversationTurn,
} from "./entries";

const props = defineProps<{
  turn: ConversationTurn;
  entries: SessionEntry[];
}>();

const userEntry = computed(() => props.turn.find(isUserMessage));
const userText = computed(() => (userEntry.value ? entryText(userEntry.value) : ""));
const agentEntries = computed(() =>
  props.turn
    .filter((entry) => !isUserMessage(entry))
    .map((entry) => {
      const text = entryText(entry);
      return {
        entry,
        activity: activitySummary(entry),
        isAssistant: isAssistantMessage(entry),
        isTool: isToolMessage(entry),
        label: entryLabel(entry),
        text,
        thinking: thinkingText(entry),
        toolCall: toolCallText(entry),
        toolPreview: toolPreview(entry, text),
      };
    }),
);
const firstAssistantEntry = computed(() => props.turn.find(isAssistantMessage));
</script>

<template>
  <article v-if="userEntry" class="conversation-entry conversation-entry--user">
    <pre class="conversation-entry__content">{{ userText }}</pre>
  </article>

  <section v-if="agentEntries.length > 0" class="conversation-turn">
    <header v-if="firstAssistantEntry" class="conversation-entry__header">
      <span class="conversation-entry__author">
        <BrainIcon />
        <span class="conversation-entry__type">{{ modelForEntry(entries, firstAssistantEntry) }}</span>
      </span>
    </header>
    <template v-for="item in agentEntries" :key="item.entry.id">
      <details v-if="item.isAssistant && item.thinking" class="conversation-entry__reasoning">
        <summary>
          <BrainIcon />
          <strong>Thinking</strong>
          <span>{{ previewText(item.thinking) }}</span>
        </summary>
        <pre>{{ item.thinking }}</pre>
      </details>
      <MarkdownRender
        v-if="item.isAssistant && item.text"
        class="conversation-entry__content"
        mode="chat"
        :content="item.text"
        :final="true"
        :fade="false"
      />
      <details v-if="item.isAssistant && item.toolCall" class="conversation-entry__tool">
        <summary>
          <TerminalIcon />
          <strong>Tool call</strong>
          <span>{{ previewText(item.toolCall) }}</span>
        </summary>
        <pre>{{ item.toolCall }}</pre>
      </details>
      <details v-else-if="item.isTool" class="conversation-entry__tool">
        <summary>
          <TerminalIcon />
          <strong>{{ item.label }}</strong>
          <span>{{ previewText(item.toolPreview) }}</span>
        </summary>
        <pre v-if="item.text">{{ item.text }}</pre>
      </details>
      <details v-else-if="!item.isAssistant" class="conversation-activity">
        <summary>
          <span>{{ item.activity }}</span>
          <time :datetime="item.entry.timestamp">{{ formatTimestamp(item.entry.timestamp) }}</time>
        </summary>
        <pre v-if="item.text" class="conversation-activity__content">{{ item.text }}</pre>
      </details>
    </template>
  </section>
</template>

<style scoped>
.conversation-entry,
.conversation-turn {
  width: 100%;
  max-width: var(--conversation-content-width);
  min-width: 0;
  margin: 0 auto;
  color: #292827;
  padding-inline: clamp(12px, 2.5vw, var(--conversation-inline-gutter));
}
.conversation-entry {
  padding-top: 24px;
}
.conversation-entry--user {
  width: fit-content;
  max-width: 85%;
  margin-right: 0;
  padding: 12px 20px;
  border: 1px solid #ece9e0;
  border-radius: 12px 12px 4px;
  background: #f7f6f2;
}
.conversation-turn {
  padding-block: 24px 32px;
}
.conversation-entry__header,
.conversation-entry__author,
.conversation-activity > summary {
  display: flex;
  align-items: center;
}
.conversation-entry__header {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #45433e;
  font-size: 14px;
  line-height: 18px;
}
.conversation-entry__author {
  gap: 10px;
}
.conversation-entry__author svg {
  width: 18px;
  height: 18px;
}
.conversation-entry__type {
  font-weight: 700;
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
.conversation-entry__content:deep(.node-slot:last-child .paragraph-node),
.conversation-entry__content:deep(.node-slot:last-child ul),
.conversation-entry__content:deep(.node-slot:last-child ol) {
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
.conversation-turn > .conversation-entry__content {
  margin-bottom: 14px;
}
.conversation-entry__reasoning,
.conversation-entry__tool {
  margin: 0 0 12px;
  padding: 0;
  color: #76746d;
  font-size: 13px;
}
.conversation-entry__tool {
  margin-bottom: 14px;
}
.conversation-entry__reasoning summary,
.conversation-entry__tool > summary {
  display: grid;
  grid-template-columns: 16px max-content minmax(0, 1fr);
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
.conversation-activity {
  display: block;
  margin: 10px 0 0;
  padding: 0;
  color: #76746d;
  font-size: 13px;
}
.conversation-activity > summary {
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.conversation-activity time {
  flex: none;
  color: #8a8881;
  font-size: 12px;
  font-weight: 400;
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
  .conversation-entry,
  .conversation-turn {
    padding-inline: clamp(var(--conversation-inline-gutter), 2.5vw, 24px);
  }
}
</style>
