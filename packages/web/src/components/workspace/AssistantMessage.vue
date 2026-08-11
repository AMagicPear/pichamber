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

const label = computed(() => asAssistant(props.message)?.model ?? "Assistant");
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
      </header>
      <ConversationDetail
        v-if="thinking"
        class="conversation-message__details"
        :icon="BrainAi3Icon"
        label="Thinking"
        :preview="inline(thinking)"
        :content="thinking"
        :auto-expand="thinkingStreaming"
        hide-preview-on-expand
        render-markdown
      />
      <MarkdownRender
        v-if="text"
        class="conversation-message__content markdown-chat"
        mode="chat"
        :content="text"
        :final="final"
        :fade="false"
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
  color: #292827;
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
  color: #a83838;
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
</style>
