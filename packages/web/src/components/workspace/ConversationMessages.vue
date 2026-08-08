<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import { computed } from "vue";
import type {
  AgentMessage,
  ConversationTranscriptMessage,
  LiveConversationState,
  LiveToolExecution,
} from "@pichamber/shared";
import BrainIcon from "@/assets/icons/Brain.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
import ConversationDetail from "./ConversationDetail.vue";
import { conversationToolDetail } from "./conversationToolDetail";

/** Structural peeks at AssistantMessage / ToolResultMessage so we don't
 *  pull @earendil-works/pi-ai into the workspace just for two fields. */
type AssistantLike = { stopReason?: "stop" | "toolUse" | "error" | "aborted"; errorMessage?: string };
type ToolResultLike = { isError?: boolean };

const props = defineProps<{
  entries: ConversationTranscriptMessage[];
  live: LiveConversationState;
}>();

const messageFor = (entry: ConversationTranscriptMessage) => entry.message;
const contentFor = (message?: AgentMessage) => message as { content?: unknown } | undefined;
const assistantLabel = (message?: AgentMessage) =>
  message?.role === "assistant" ? message.model : "Assistant";

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
const inlinePreview = (text: string) => text.replace(/\s+/g, " ").trim();
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

type AssistantError = { reason: "error" | "aborted"; message: string };
const assistantError = (message?: AgentMessage): AssistantError | undefined => {
  if (message?.role !== "assistant") return undefined;
  const stopReason = (message as AssistantLike).stopReason;
  if (stopReason !== "error" && stopReason !== "aborted") return undefined;
  const text = (message as AssistantLike).errorMessage?.trim();
  // Pi fills `errorMessage` for both error/aborted; if it's empty, fall back to
  // the stopReason so the panel never renders as a phantom empty bubble.
  return { reason: stopReason, message: text || `Assistant turn ${stopReason}` };
};

type ToolCall = { id: string; name: string; arguments: unknown };

const toolCallsById = computed(() => {
  const calls = new Map<string, ToolCall>();
  for (const entry of props.entries) {
    const content = contentFor(messageFor(entry))?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object" || !("type" in part) || part.type !== "toolCall") continue;
      if (typeof part.id !== "string" || typeof part.name !== "string") continue;
      calls.set(part.id, { id: part.id, name: part.name, arguments: part.arguments });
    }
  }
  return calls;
});

const historyToolDetail = (entry: ConversationTranscriptMessage) => {
  const message = messageFor(entry) as { toolCallId?: unknown; toolName?: unknown } | undefined;
  const toolCallId = typeof message?.toolCallId === "string" ? message.toolCallId : undefined;
  const call = toolCallId ? toolCallsById.value.get(toolCallId) : undefined;
  const toolName = typeof message?.toolName === "string" ? message.toolName : "";
  const toolMessage = messageFor(entry) as ToolResultLike | undefined;
  const output = messageText(messageFor(entry)) || JSON.stringify(messageFor(entry), null, 2);
  return conversationToolDetail({
    toolName,
    args: call?.arguments,
    output,
    isError: toolMessage?.isError === true,
    fallbackPreview: messageText(messageFor(entry)),
  });
};

const liveToolDetails = computed(() =>
  props.live.toolExecutions.map((tool) => ({
    toolCallId: tool.toolCallId,
    detail: conversationToolDetail({
      toolName: tool.toolName,
      args: tool.args,
      output: JSON.stringify(tool.result === undefined ? tool.args : tool.result, null, 2),
      isError: tool.isError === true,
      fallbackPreview: JSON.stringify(tool.args),
    }),
  })),
);
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
        'conversation-message--tool-result': messageFor(entry)?.role === 'toolResult',
        'conversation-message--assistant-error':
          messageFor(entry)?.role === 'assistant' && !!assistantError(messageFor(entry)),
        'conversation-message--tool-error':
          messageFor(entry)?.role === 'toolResult' &&
          (messageFor(entry) as ToolResultLike)?.isError === true,
      }"
    >
      <pre v-if="messageFor(entry)?.role === 'user'" class="conversation-message__user">{{ messageText(messageFor(entry)) }}</pre>
      <template v-else-if="messageFor(entry)?.role === 'assistant'">
        <template v-if="assistantError(messageFor(entry)) as AssistantError">
          <header class="conversation-message__author conversation-message__author--error">
            <BrainIcon /> {{ assistantLabel(messageFor(entry)) }}
            <span class="conversation-message__error-tag">{{ assistantError(messageFor(entry))!.reason }}</span>
          </header>
          <p class="conversation-message__error-text">{{ assistantError(messageFor(entry))!.message }}</p>
        </template>
        <template v-else>
          <header class="conversation-message__author"><BrainIcon /> {{ assistantLabel(messageFor(entry)) }}</header>
          <ConversationDetail v-if="thinkingText(messageFor(entry))" class="conversation-message__details" :icon="BrainIcon" label="Thinking" :preview="inlinePreview(thinkingText(messageFor(entry)))" :content="thinkingText(messageFor(entry))" />
          <MarkdownRender v-if="messageText(messageFor(entry))" class="conversation-message__content" mode="chat" :content="messageText(messageFor(entry))" :final="true" :fade="false" />
        </template>
      </template>
      <ConversationDetail v-else-if="messageFor(entry)?.role === 'toolResult'" class="conversation-message__details conversation-message__tool-result" :icon="TerminalIcon" :icon-url="historyToolDetail(entry).iconUrl" :label="historyToolDetail(entry).label" :preview="historyToolDetail(entry).preview" :preview-tail="historyToolDetail(entry).previewTail" :content="historyToolDetail(entry).content" />
    </article>

    <article v-for="(message, index) in live.pendingUserMessages" :key="`live-user:${index}`" class="conversation-message conversation-message--user">
      <pre class="conversation-message__user">{{ messageText(message) }}</pre>
    </article>
    <article v-if="live.streamingMessage" class="conversation-message conversation-message--assistant">
      <header class="conversation-message__author"><BrainIcon /> {{ assistantLabel(live.streamingMessage) }}</header>
      <ConversationDetail v-if="thinkingText(live.streamingMessage)" class="conversation-message__details" :icon="BrainIcon" label="Thinking" :preview="inlinePreview(thinkingText(live.streamingMessage))" :content="thinkingText(live.streamingMessage)" />
      <MarkdownRender v-if="messageText(live.streamingMessage)" class="conversation-message__content" mode="chat" :content="messageText(live.streamingMessage)" :final="false" :fade="false" />
    </article>
    <ConversationDetail v-for="tool in liveToolDetails" :key="tool.toolCallId" class="conversation-message conversation-message__details conversation-message__tool-result" :class="{ 'conversation-message--tool-error': tool.detail.isError }" :icon="TerminalIcon" :icon-url="tool.detail.iconUrl" :label="tool.detail.label" :preview="tool.detail.preview" :preview-tail="tool.detail.previewTail" :content="tool.detail.content" />
  </div>
</template>

<style scoped>
.conversation__messages { flex: 1; align-self: stretch; width: 100%; min-width: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 24px max(var(--conversation-inline-gutter), calc((100% - var(--conversation-shell-width)) / 2)) 32px; }
.conversation-message { width: 100%; max-width: var(--conversation-content-width); min-width: 0; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, var(--conversation-inline-gutter)); color: #292827; }
.conversation-message + .conversation-message { margin-top: 28px; }
.conversation-message--assistant + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--assistant, .conversation-message--tool-result + .conversation-message--user { margin-top: 28px; }
.conversation-message--assistant-error + .conversation-message { margin-top: 28px; }
.conversation-message__user { width: fit-content; max-width: 85%; margin: 0 0 0 auto; padding: 12px 20px; border: 1px solid #ece9e0; border-radius: 12px 12px 4px; white-space: pre-wrap; overflow-wrap: anywhere; background: #f7f6f2; }
.conversation-message__author { display: flex; align-items: center; gap: 8px; }
.conversation-message__author { margin: 0; color: #292827; font-size: 15px; font-weight: 700; }
.conversation-message__author svg { flex: 0 0 16px; width: 16px; height: 16px; }
.conversation-message__author + .conversation-message__content, .conversation-message__author + .conversation-message__details, .conversation-message__author--error + .conversation-message__error-text { margin-top: 12px; }
.conversation-message__details + .conversation-message__content { margin-top: 12px; }
.conversation-message__content + .conversation-message__details { margin-top: 12px; }
.conversation-message__content, .conversation-message__content :deep(.markdown-renderer) { --ms-text-body: 14px; --ms-leading-body: 1.5; --ms-text-h1: 20px; --ms-leading-h1: 1.25; --ms-text-h2: 17px; --ms-leading-h2: 1.3; --ms-text-h3: 15px; --ms-leading-h3: 1.35; --ms-text-h4: 14px; --ms-text-h5: 14px; --ms-text-h6: 14px; --ms-flow-paragraph-y: 8px; --ms-flow-list-y: 8px; --ms-flow-list-item-y: 2px; --ms-flow-codeblock-y: 12px; --ms-flow-blockquote-y: 10px; --ms-flow-table-y: 12px; --ms-flow-hr-y: 16px; --ms-flow-heading-1-mb: 10px; --ms-flow-heading-2-mt: 18px; --ms-flow-heading-2-mb: 8px; --ms-flow-heading-3-mt: 16px; --ms-flow-heading-3-mb: 8px; --ms-flow-heading-4-mt: 14px; --ms-flow-heading-4-mb: 6px; --ms-flow-heading-5-mt: 14px; --ms-flow-heading-5-mb: 6px; --ms-flow-heading-6-mt: 14px; --ms-flow-heading-6-mb: 6px; color: #292827; overflow-wrap: anywhere; }
.conversation-message__content :deep(.conversation-code-block) { margin-block: 12px; }

/* Error variants: red accent on the message block, the model name, and
 * the tool row so failed turns read at a glance instead of looking like
 * an empty successful bubble. */
.conversation-message--assistant-error {
  padding: 14px 16px;
  border: 1px solid #f4c2c2;
  border-radius: 10px;
  background: rgb(255 240 240 / 60%);
}
.conversation-message--assistant-error .conversation-message__author--error {
  color: #a83838;
}
.conversation-message__author--error {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.conversation-message__error-tag {
  padding: 1px 8px;
  border: 1px solid #e8b5b5;
  border-radius: 999px;
  color: #a83838;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.conversation-message__error-text {
  margin: 0;
  color: #6f2828;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.conversation-message--tool-error :deep(.conversation-detail__label) {
  color: #a83838;
}
</style>