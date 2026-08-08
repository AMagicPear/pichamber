<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import type { AgentMessage, ConversationTranscriptMessage, LiveConversationState } from "@pichamber/shared";
import BrainIcon from "@/assets/icons/Brain.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";

const props = defineProps<{
  entries: ConversationTranscriptMessage[];
  live: LiveConversationState;
}>();

const messageFor = (entry: ConversationTranscriptMessage) => entry.message;
const contentFor = (message?: AgentMessage) => message as { content?: unknown } | undefined;

const textFromContent = (content: unknown) =>
  Array.isArray(content)
    ? content
        .map((part) =>
          part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
            ? String(part.text)
            : "",
        )
        .filter(Boolean)
        .join("\n\n")
    : typeof content === "string"
      ? content
      : "";

const messageText = (message?: AgentMessage) => textFromContent(contentFor(message)?.content);
const thinkingText = (message?: AgentMessage) => {
  const content = contentFor(message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "thinking" && "thinking" in part
        ? String(part.thinking)
        : "",
    )
    .filter(Boolean)
    .join("\n\n");
};

const toolCalls = (message?: AgentMessage) => {
  const content = contentFor(message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "toolCall"
        ? `${"name" in part ? String(part.name) : "tool"}${"arguments" in part ? ` ${JSON.stringify(part.arguments)}` : ""}`
        : "",
    )
    .filter(Boolean)
    .join("\n");
};

const toolName = (message?: AgentMessage) => {
  const value = message as { toolName?: unknown } | undefined;
  return typeof value?.toolName === "string" ? value.toolName : undefined;
};
const toolCallFor = (entry: ConversationTranscriptMessage) => {
  const result = messageFor(entry) as { toolCallId?: unknown } | undefined;
  if (typeof result?.toolCallId !== "string") return undefined;
  for (let index = props.entries.indexOf(entry) - 1; index >= 0; index -= 1) {
    const content = contentFor(messageFor(props.entries[index]!))?.content;
    if (!Array.isArray(content)) continue;
    const call = content.find(
      (part) => part && typeof part === "object" && "type" in part && part.type === "toolCall" && "id" in part && part.id === result.toolCallId,
    );
    if (call) return call as { arguments?: unknown };
  }
};
const toolTarget = (entry: ConversationTranscriptMessage, key: "path" | "command") => {
  const args = toolCallFor(entry)?.arguments;
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const value = record[key] ?? (key === "path" ? record.file_path : undefined);
  return typeof value === "string" ? value : undefined;
};
const toolResultLabel = (entry: ConversationTranscriptMessage) => {
  const name = toolName(messageFor(entry));
  const path = toolTarget(entry, "path");
  if (name === "read") return path ? `Read ${path}` : "Read file";
  if (name === "write") return path ? `Wrote ${path}` : "Wrote file";
  if (name === "edit") return path ? `Edited ${path}` : "Edited file";
  if (name === "ls") return path ? `Listed ${path}` : "Listed directory";
  if (name === "bash") return toolTarget(entry, "command") ?? "Command output";
  return name ? `${name} result` : "Tool result";
};
const toolResultText = (entry: ConversationTranscriptMessage) => messageText(messageFor(entry)) || JSON.stringify(messageFor(entry), null, 2);
</script>

<template>
  <div class="conversation__messages">
    <article
      v-for="entry in entries"
      :key="entry.id"
      class="conversation-message"
      :class="{
        'conversation-message--user': messageFor(entry)?.role === 'user',
        'conversation-message--assistant': messageFor(entry)?.role === 'assistant',
      }"
    >
      <pre v-if="messageFor(entry)?.role === 'user'" class="conversation-message__user">{{ messageText(messageFor(entry)) }}</pre>
      <template v-else-if="messageFor(entry)?.role === 'assistant'">
        <header class="conversation-message__author"><BrainIcon /> Assistant</header>
        <details v-if="thinkingText(messageFor(entry))" class="conversation-message__details"><summary><BrainIcon /> Thinking</summary><pre>{{ thinkingText(messageFor(entry)) }}</pre></details>
        <MarkdownRender v-if="messageText(messageFor(entry))" class="conversation-message__content" mode="chat" :content="messageText(messageFor(entry))" :final="true" :fade="false" />
        <details v-if="toolCalls(messageFor(entry))" class="conversation-message__details"><summary><TerminalIcon /> Tool call</summary><pre>{{ toolCalls(messageFor(entry)) }}</pre></details>
      </template>
      <details v-else-if="messageFor(entry)?.role === 'toolResult'" class="conversation-message__details conversation-message__tool-result">
        <summary><TerminalIcon /> {{ toolResultLabel(entry) }}</summary><pre>{{ toolResultText(entry) }}</pre>
      </details>
    </article>

    <article v-for="(message, index) in live.pendingUserMessages" :key="`live-user:${index}`" class="conversation-message conversation-message--user">
      <pre class="conversation-message__user">{{ messageText(message) }}</pre>
    </article>
    <article v-if="live.streamingMessage" class="conversation-message conversation-message--assistant">
      <header class="conversation-message__author"><BrainIcon /> Assistant</header>
      <details v-if="thinkingText(live.streamingMessage)" class="conversation-message__details"><summary><BrainIcon /> Thinking</summary><pre>{{ thinkingText(live.streamingMessage) }}</pre></details>
      <MarkdownRender v-if="messageText(live.streamingMessage)" class="conversation-message__content" mode="chat" :content="messageText(live.streamingMessage)" :final="false" :fade="false" />
    </article>
    <details v-for="tool in live.toolExecutions" :key="tool.toolCallId" class="conversation-message conversation-message__details conversation-message__tool-result">
      <summary><TerminalIcon /> {{ tool.running ? `${tool.toolName} running` : `${tool.toolName} result` }}</summary>
      <pre>{{ tool.result === undefined ? JSON.stringify(tool.args, null, 2) : JSON.stringify(tool.result, null, 2) }}</pre>
    </details>
  </div>
</template>

<style scoped>
.conversation__messages { flex: 1; align-self: stretch; width: 100%; min-width: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 0 max(var(--conversation-inline-gutter), calc((100% - var(--conversation-shell-width)) / 2)); }
.conversation-message { width: 100%; max-width: var(--conversation-content-width); min-width: 0; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, var(--conversation-inline-gutter)); color: #292827; }
.conversation-message--user, .conversation-message--assistant { padding-block: 0; }
.conversation-message__user { width: fit-content; max-width: 85%; margin: 0 0 0 auto; padding: 12px 20px; border: 1px solid #ece9e0; border-radius: 12px 12px 4px; white-space: pre-wrap; overflow-wrap: anywhere; background: #f7f6f2; }
.conversation-message__author, .conversation-message__details summary { display: flex; align-items: center; gap: 8px; }
.conversation-message__author { margin: 0; color: #45433e; font-size: 14px; font-weight: 700; }
.conversation-message__author svg, .conversation-message__details summary svg { width: 16px; height: 16px; }
.conversation-message__content, .conversation-message__content :deep(.markdown-renderer) { --ms-text-body: 14px; --ms-leading-body: 1.5; --ms-text-h1: 20px; --ms-leading-h1: 1.25; --ms-text-h2: 17px; --ms-leading-h2: 1.3; --ms-text-h3: 15px; --ms-leading-h3: 1.35; --ms-text-h4: 14px; --ms-text-h5: 14px; --ms-text-h6: 14px; --ms-flow-paragraph-y: 0; --ms-flow-list-y: 0; --ms-flow-list-item-y: 0; --ms-flow-codeblock-y: 0; --ms-flow-blockquote-y: 0; --ms-flow-table-y: 0; --ms-flow-hr-y: 0; --ms-flow-heading-1-mb: 0; --ms-flow-heading-2-mt: 0; --ms-flow-heading-2-mb: 0; --ms-flow-heading-3-mt: 0; --ms-flow-heading-3-mb: 0; --ms-flow-heading-4-mt: 0; --ms-flow-heading-4-mb: 0; --ms-flow-heading-5-mt: 0; --ms-flow-heading-5-mb: 0; --ms-flow-heading-6-mt: 0; --ms-flow-heading-6-mb: 0; color: #292827; overflow-wrap: anywhere; }
.conversation-message__content, .conversation-message__content * { margin-block: 0 !important; }
.conversation-message__details { margin: 0; color: #76746d; font-size: 13px; }
.conversation-message__details summary { cursor: pointer; }
.conversation-message__details pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
