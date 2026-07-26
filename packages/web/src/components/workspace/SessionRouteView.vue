<script setup lang="ts">
import ConversationPanel from "./ConversationPanel.vue";

defineProps<{
  sessionId?: string | null;
}>();
</script>

<template>
  <ConversationPanel :session-id="sessionId" />
</template>
