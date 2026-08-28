<script setup lang="ts">
import { computed } from "vue";
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import MarkdownRender from "markstream-vue";
import { messageText } from "./messageContent";
import SummaryCard from "./SummaryCard.vue";
import { useMarkdownRender } from "./useMarkdownRender";
import { useI18n } from "vue-i18n";

type CustomOrBranch = AgentMessage & { role: "custom" | "branchSummary" };

const props = defineProps<{ message: CustomOrBranch }>();
const { t } = useI18n();

const text = computed(() => messageText(props.message));
const markdownRenderProps = useMarkdownRender();
</script>

<template>
  <article class="conversation-message conversation-message--custom">
    <SummaryCard
      :kind="message.role"
      :label="t(message.role === 'branchSummary' ? 'conversation.branchSummary' : 'conversation.customSummary')"
    >
      <MarkdownRender v-if="text" class="markdown-chat" v-bind="markdownRenderProps" :content="text" />
    </SummaryCard>
  </article>
</template>

<style scoped>
.conversation-message--custom { content-visibility: auto; contain-intrinsic-size: auto 80px; }
</style>
