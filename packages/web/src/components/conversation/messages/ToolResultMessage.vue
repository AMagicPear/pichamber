<script setup lang="ts">
import ToolIcon from "@/assets/icons/Tool.svg";
import { settings } from "@/stores/settings";
import type { ConversationToolDetail } from "./conversationToolDetail";
import ConversationDetail from "./ConversationDetail.vue";

defineProps<{
  detail: ConversationToolDetail;
}>();
</script>

<template>
  <article
    class="conversation-message conversation-message--tool-result"
    :class="{ 'conversation-message--tool-error': detail.isError }"
  >
    <ConversationDetail
      class="conversation-message__details"
      :icon="detail.icon ?? ToolIcon"
      :label="detail.label"
      :preview="detail.preview"
      :path="detail.path"
      :timeout="detail.timeout"
      :running="detail.running"
      :started-at="detail.startedAt"
      :body="detail.body"
      :default-expanded="settings.expandedToolResults"
    />
  </article>
</template>

<style scoped>
/* Red label on the detail header so failed tool calls read at a glance. */
.conversation-message--tool-error :deep(.conversation-detail__label) {
  color: var(--ui-error-strong);
}
</style>