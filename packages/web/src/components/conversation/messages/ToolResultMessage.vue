<script setup lang="ts">
import { settings } from "@/stores/settings";
import type { ConversationToolDetail } from "./conversationToolDetail";
import ConversationDetail from "./ConversationDetail.vue";

defineProps<{
  detail: ConversationToolDetail;
}>();
</script>

<template>
  <article class="conversation-message conversation-message--tool-result"
    :class="{ 'conversation-message--tool-error': detail.isError }">
    <ConversationDetail class="conversation-message__details" v-bind="detail"
      :auto-expand="settings.expandWhileStreaming && detail.running" />
  </article>
</template>

<style scoped>
/* Red label on the detail header so failed tool calls read at a glance. */
.conversation-message--tool-error :deep(.conversation-detail__label) {
  color: var(--ui-error-strong);
}
</style>
