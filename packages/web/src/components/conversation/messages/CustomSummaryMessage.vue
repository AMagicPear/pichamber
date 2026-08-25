<script setup lang="ts">
import { computed } from "vue";
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import MarkdownRender from "markstream-vue";
import { messageText } from "./messageContent";
import SummaryCard from "./SummaryCard.vue";
import { useMarkdownRender } from "./useMarkdownRender";

type CustomOrBranch = AgentMessage & { role: "custom" | "branchSummary" };

const props = defineProps<{ message: CustomOrBranch }>();

const text = computed(() => messageText(props.message));
const markdownRenderProps = useMarkdownRender();
</script>

<template>
  <article class="conversation-message conversation-message--custom">
    <SummaryCard size="compact">
      <template #header>
        <span class="custom-summary__label">[{{ message.role }}]</span>
      </template>
      <MarkdownRender v-if="text" class="markdown-chat" v-bind="markdownRenderProps" :content="text" />
    </SummaryCard>
  </article>
</template>

<style scoped>
.conversation-message--custom { content-visibility: auto; contain-intrinsic-size: auto 80px; }
.custom-summary__label {
  font-weight: 600;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
