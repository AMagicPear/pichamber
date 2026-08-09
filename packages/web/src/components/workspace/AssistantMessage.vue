<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import { computed } from "vue";
import type { AgentMessage } from "@pichamber/shared";
import BrainAi3Icon from "@/assets/icons/BrainAi3.svg";
import ConversationDetail from "./ConversationDetail.vue";
import ProviderLogo from "./ProviderLogo";
import { inline, messageText, thinkingText } from "./messageContent";

/** Structural peeks at AssistantMessage so we don't pull @earendil-works/pi-ai
 *  into the workspace just for two fields. */
type AssistantLike = {
  provider?: string;
  stopReason?: "stop" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
};

const props = defineProps<{
  message: AgentMessage;
  /** False while the assistant is still streaming. */
  final?: boolean;
}>();

const error = computed(() => {
  if (props.message.role !== "assistant") return undefined;
  const stopReason = (props.message as AssistantLike).stopReason;
  if (stopReason !== "error" && stopReason !== "aborted") return undefined;
  const text = (props.message as AssistantLike).errorMessage?.trim();
  // Pi fills `errorMessage` for both error/aborted; if it's empty, fall back to
  // the stopReason so the panel never renders as a phantom empty bubble.
  return { reason: stopReason, message: text || `Assistant turn ${stopReason}` };
});

const label = computed(() =>
  props.message.role === "assistant" ? props.message.model : "Assistant",
);
const provider = computed(() =>
  props.message.role === "assistant" ? ((props.message as AssistantLike).provider ?? "") : "",
);
const text = computed(() => messageText(props.message));
const thinking = computed(() => thinkingText(props.message));
</script>

<template>
  <article
    class="conversation-message conversation-message--assistant"
    :class="{ 'conversation-message--assistant-error': error }"
  >
    <template v-if="error">
      <header class="conversation-message__author conversation-message__author--error">
        <ProviderLogo :provider-id="provider" :size="16" />
        {{ label }}
        <span class="conversation-message__error-tag">{{ error.reason }}</span>
      </header>
      <p class="conversation-message__error-text">{{ error.message }}</p>
    </template>
    <template v-else>
      <header class="conversation-message__author">
        <ProviderLogo :provider-id="provider" :size="16" /> {{ label }}
      </header>
      <ConversationDetail
        v-if="thinking"
        class="conversation-message__details"
        :icon="BrainAi3Icon"
        label="Thinking"
        :preview="inline(thinking)"
        :content="thinking"
      />
      <MarkdownRender
        v-if="text"
        class="conversation-message__content"
        mode="chat"
        :content="text"
        :final="final"
        :fade="false"
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
.conversation-message__content,
.conversation-message__content :deep(.markdown-renderer) {
  --ms-text-body: 14px;
  --ms-leading-body: 1.5;
  --ms-text-h1: 20px;
  --ms-leading-h1: 1.25;
  --ms-text-h2: 17px;
  --ms-leading-h2: 1.3;
  --ms-text-h3: 15px;
  --ms-leading-h3: 1.35;
  --ms-text-h4: 14px;
  --ms-text-h5: 14px;
  --ms-text-h6: 14px;
  --ms-flow-paragraph-y: 8px;
  --ms-flow-list-y: 8px;
  --ms-flow-list-item-y: 2px;
  --ms-flow-codeblock-y: 12px;
  --ms-flow-blockquote-y: 10px;
  --ms-flow-table-y: 12px;
  --ms-flow-hr-y: 16px;
  --ms-flow-heading-1-mb: 10px;
  --ms-flow-heading-2-mt: 18px;
  --ms-flow-heading-2-mb: 8px;
  --ms-flow-heading-3-mt: 16px;
  --ms-flow-heading-3-mb: 8px;
  --ms-flow-heading-4-mt: 14px;
  --ms-flow-heading-4-mb: 6px;
  --ms-flow-heading-5-mt: 14px;
  --ms-flow-heading-5-mb: 6px;
  --ms-flow-heading-6-mt: 14px;
  --ms-flow-heading-6-mb: 6px;
  color: #292827;
  overflow-wrap: anywhere;
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
