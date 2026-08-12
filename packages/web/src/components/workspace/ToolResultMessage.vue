<script setup lang="ts">
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
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
      :icon="detail.icon ?? TerminalIcon"
      :label="detail.label"
      :preview="detail.preview"
      :path="detail.path"
      :content="detail.content"
      :diff="detail.diff"
      :codeFileName="detail.codeFileName"
      :images="detail.images"
    />
  </article>
</template>
