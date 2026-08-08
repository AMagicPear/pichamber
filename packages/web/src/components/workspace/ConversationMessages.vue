<script setup lang="ts">
import { computed } from "vue";
import type { SessionEntry } from "@pichamber/shared";
import ConversationTurn from "@/components/workspace/conversation/ConversationTurn.vue";
import { groupConversationEntries } from "@/components/workspace/conversation/entries";

const props = defineProps<{
  entries: SessionEntry[];
}>();

const turns = computed(() => groupConversationEntries(props.entries));
</script>

<template>
  <div class="conversation__messages">
    <ConversationTurn
      v-for="turn in turns"
      :key="turn.at(-1)?.id"
      :turn="turn"
      :entries="entries"
    />
  </div>
</template>

<style scoped>
.conversation__messages {
  flex: 1;
  align-self: stretch;
  width: 100%;
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 max(
    var(--conversation-inline-gutter),
    calc((100% - var(--conversation-shell-width)) / 2)
  ) 16px;
}
</style>
