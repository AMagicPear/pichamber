<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import { computed } from "vue";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@pichamber/shared";
import BrainAi3Icon from "@/assets/icons/BrainAi3.svg";
import ConversationDetail from "./ConversationDetail.vue";
import ProviderLogo from "./ProviderLogo";
import { inline, messageText, thinkingStreaming as thinkingStreamingOf, thinkingText } from "./messageContent";

/** 从 AgentMessage union 里取 assistant 消息（pi-ai 类型带真实字段）。 */
const asAssistant = (message: AgentMessage): AssistantMessage | undefined =>
  message.role === "assistant" ? (message as AssistantMessage) : undefined;

const props = defineProps<{
  message: AgentMessage;
  /** False while the assistant is still streaming. */
  final?: boolean;
  /** Friendly model name resolved from the current model registry. */
  modelName?: string;
  /** Render a timestamp row under the message body. */
  showTimestamp?: boolean;
  /** Pre-formatted by the parent from message.timestamp. */
  timestampText?: string;
}>();

const error = computed(() => {
  const assistant = asAssistant(props.message);
  if (!assistant) return undefined;
  const stopReason = assistant.stopReason;
  if (stopReason !== "error" && stopReason !== "aborted") return undefined;
  const text = assistant.errorMessage?.trim();
  // Pi fills `errorMessage` for both error/aborted; if it's empty, fall back to
  // the stopReason so the panel never renders as a phantom empty bubble.
  return { reason: stopReason, message: text || `Assistant turn ${stopReason}` };
});

const label = computed(() => props.modelName ?? asAssistant(props.message)?.model ?? "Assistant");
const provider = computed(() => asAssistant(props.message)?.provider ?? "");
const modelId = computed(() => asAssistant(props.message)?.model ?? "");
const text = computed(() => messageText(props.message));
const thinking = computed(() => thinkingText(props.message));
/** Auto expand/collapse the Thinking detail: expanded while the model is
 *  still streaming into a thinking part, collapsed when it ends. */
const thinkingStreaming = computed(() => thinkingStreamingOf(props.message, props.final));
</script>

<template>
  <article
    class="conversation-message conversation-message--assistant"
    :class="{ 'conversation-message--assistant-error': error }"
  >
    <template v-if="error">
      <header class="conversation-message__author conversation-message__author--error">
        <ProviderLogo :provider-id="provider" :model-id="modelId" :size="16" />
        {{ label }}
        <span class="conversation-message__error-tag">{{ error.reason }}</span>
      </header>
      <p class="conversation-message__error-text">{{ error.message }}</p>
    </template>
    <template v-else>
      <header class="conversation-message__author">
        <ProviderLogo :provider-id="provider" :model-id="modelId" :size="16" /> {{ label }}
        <time v-if="showTimestamp && timestampText" class="conversation-message__time">{{ timestampText }}</time>
      </header>
      <ConversationDetail
        v-if="thinking"
        class="conversation-message__details"
        :icon="BrainAi3Icon"
        label="Thinking"
        :preview="inline(thinking)"
        :body="{ kind: 'markdown', content: thinking }"
        :auto-expand="thinkingStreaming"
        hide-preview-on-expand
      />
      <MarkdownRender
        v-if="text"
        class="conversation-message__content markdown-chat"
        mode="chat"
        :content="text"
        :final="final"
        :fade="false"
        :code-block-monaco-options="{ disableFileHeader: true }"
        :viewport-priority="false"
      />
    </template>
  </article>
</template>

<style scoped>
.conversation-message__author {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ui-text-strong);
  font-size: 15px;
  font-weight: 700;
}
.conversation-message__author svg {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
}
.conversation-message__author + .conversation-message__content,
.conversation-message__author + .conversation-message__details,
.conversation-message__author--error + .conversation-message__error-text {
  margin-top: 12px;
}
.conversation-message__details + .conversation-message__content {
  margin-top: 12px;
}
.conversation-message__content + .conversation-message__details {
  margin-top: 12px;
}
.conversation-message__content :deep(.conversation-code-block) {
  margin-block: 12px;
}

/* Error variant: red accent on the model name and the message so failed
 * turns read at a glance instead of looking like an empty successful bubble. */
.conversation-message__author--error {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-error-strong);
}
.conversation-message__error-tag {
  padding: 1px 8px;
  border: 1px solid var(--ui-error-border);
  border-radius: 999px;
  color: var(--ui-error-strong);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.conversation-message__error-text {
  margin: 0;
  color: var(--ui-error-fg);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Timestamp sits inline in the author row, muted, right after the model
 * name. The assistant body is a full-width left-anchored block, so a
 * footer under it has no natural edge to follow — left-aligned looks
 * sparse under a short reply and right-aligned dangles at the column's
 * far right. Inline in the header reads as message metadata and avoids
 * the detached-footer problem entirely. */
/* Time sits next to the model name and aligns with its bottom (the name's
 * baseline) rather than vertically centering in the taller author row — it
 * reads as a small trailing label off the name, not a middle block. */
.conversation-message__time {
  align-self: flex-end;
  margin-bottom: 1px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
}
</style>
