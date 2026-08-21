<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import { computed } from "vue";
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import { messageText } from "./messageContent";

type CustomOrBranch = AgentMessage & { role: "custom" | "branchSummary" };

const props = defineProps<{ message: CustomOrBranch }>();

const text = computed(() => messageText(props.message));
</script>

<template>
  <article class="conversation-message conversation-message--custom">
    <div class="custom-summary">
      <div class="custom-summary__header">
        <span class="custom-summary__label">[{{ message.role }}]</span>
      </div>
      <MarkdownRender
        v-if="text"
        class="markdown-chat"
        mode="chat"
        :content="text"
        :final="true"
        :fade="false"
        :viewport-priority="false"
      />
    </div>
  </article>
</template>

<style scoped>
.conversation-message--custom { content-visibility: auto; contain-intrinsic-size: auto 80px; }

.custom-summary {
  padding: 10px 14px;
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-secondary);
  font-size: 13px;
}
.custom-summary__header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
.custom-summary__label {
  font-weight: 600;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
