<script setup lang="ts">
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import MarkdownRender from "markstream-vue";
import SummaryCard from "./SummaryCard.vue";
import { useMarkdownRender } from "./useMarkdownRender";

type CompactionSummary = AgentMessage & {
  role: "compactionSummary";
  tokensBefore: number;
  summary: string;
};

defineProps<{ message: CompactionSummary }>();
const markdownRenderProps = useMarkdownRender();
</script>

<template>
  <article class="conversation-message conversation-message--compaction">
    <SummaryCard>
      <template #header>
        <span class="compaction-summary__label">[compaction]</span>
        <span class="compaction-summary__meta">Compacted from {{ message.tokensBefore.toLocaleString() }} tokens</span>
      </template>
      <MarkdownRender class="markdown-chat" v-bind="markdownRenderProps" :content="message.summary" />
    </SummaryCard>
  </article>
</template>

<style scoped>
.conversation-message--compaction { content-visibility: auto; contain-intrinsic-size: auto 120px; }
.compaction-summary__label { font-weight: 700; color: var(--ui-text); }
.compaction-summary__meta { color: var(--ui-text-tertiary); font-size: 12px; }
</style>
