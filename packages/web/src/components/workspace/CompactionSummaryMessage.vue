<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import type { AgentMessage } from "@amagicpear/pichamber-shared";

type CompactionSummary = AgentMessage & {
  role: "compactionSummary";
  tokensBefore: number;
  summary: string;
};

defineProps<{ message: CompactionSummary }>();
</script>

<template>
  <article class="conversation-message conversation-message--compaction">
    <div class="compaction-summary">
      <div class="compaction-summary__header">
        <span class="compaction-summary__label">[compaction]</span>
        <span class="compaction-summary__meta">Compacted from {{ message.tokensBefore.toLocaleString() }} tokens</span>
      </div>
      <MarkdownRender
        class="markdown-chat"
        mode="chat"
        :content="message.summary"
        :final="true"
        :fade="false"
        :viewport-priority="false"
      />
    </div>
  </article>
</template>

<style scoped>
.conversation-message--compaction { content-visibility: auto; contain-intrinsic-size: auto 120px; }

/* Quiet inset card between messages, mirroring the TUI's
   CompactionSummaryMessage. */
.compaction-summary {
  padding: 12px 16px;
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-secondary);
  font-size: 14px;
}
.compaction-summary__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.compaction-summary__label { font-weight: 700; color: var(--ui-text); }
.compaction-summary__meta { color: var(--ui-text-tertiary); font-size: 12px; }
</style>
