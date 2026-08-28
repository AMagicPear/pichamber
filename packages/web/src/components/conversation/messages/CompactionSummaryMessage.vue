<script setup lang="ts">
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import MarkdownRender from "markstream-vue";
import SummaryCard from "./SummaryCard.vue";
import { useMarkdownRender } from "./useMarkdownRender";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

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
    <SummaryCard
      kind="compaction"
      :label="t('conversation.compaction')"
      :meta="t('conversation.compactedFrom', { count: message.tokensBefore.toLocaleString() })"
    >
      <MarkdownRender class="markdown-chat" v-bind="markdownRenderProps" :content="message.summary" />
    </SummaryCard>
  </article>
</template>

<style scoped>
.conversation-message--compaction { content-visibility: auto; contain-intrinsic-size: auto 120px; }
</style>
