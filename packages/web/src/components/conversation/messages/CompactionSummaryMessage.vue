<script setup lang="ts">
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import ChatMarkdown from "./ChatMarkdown.vue";
import SummaryCard from "./SummaryCard.vue";

type CompactionSummary = AgentMessage & {
  role: "compactionSummary";
  tokensBefore: number;
  summary: string;
};

defineProps<{ message: CompactionSummary }>();
</script>

<template>
  <article class="conversation-message conversation-message--compaction">
    <SummaryCard>
      <template #header>
        <span class="compaction-summary__label">[compaction]</span>
        <span class="compaction-summary__meta">Compacted from {{ message.tokensBefore.toLocaleString() }} tokens</span>
      </template>
      <ChatMarkdown :content="message.summary" />
    </SummaryCard>
  </article>
</template>

<style scoped>
.conversation-message--compaction { content-visibility: auto; contain-intrinsic-size: auto 120px; }
.compaction-summary__label { font-weight: 700; color: var(--ui-text); }
.compaction-summary__meta { color: var(--ui-text-tertiary); font-size: 12px; }
</style>
