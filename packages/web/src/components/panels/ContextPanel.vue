<script setup lang="ts">
import { computed } from "vue";
import type { SessionStatsView } from "@amagicpear/pichamber-shared";
import { useConversationSession } from "@/composables/useConversationSession";

const { stats } = useConversationSession();

const view = computed<SessionStatsView | undefined>(() => stats.value);

/** Distinguishes "no model loaded yet" from a populated zero state. The
 *  empty state copy ("Send a message to start…") is friendlier than a wall
 *  of zeros and dashes. */
const hasData = computed(
  () =>
    !!view.value &&
    (!!view.value.model || view.value.messages.total > 0 || !!view.value.modified),
);

const usageRows = computed(() => {
  const text = view.value?.lastAssistantText ?? {
    input: "0",
    output: "0",
    reasoning: "0",
    cacheRead: "0",
    cacheWrite: "0",
  };
  // Order matches the openchamber reference; reasoning sits between output
  // and cacheRead so the eye scans the production tokens first, then the
  // billing-relevant cache buckets.
  return [
    { label: "Input", value: text.input },
    { label: "Output", value: text.output },
    { label: "Reasoning", value: text.reasoning },
    { label: "Cache Read", value: text.cacheRead },
    { label: "Cache Write", value: text.cacheWrite },
  ];
});

/** "OpenCode Zen / hy3-free" — keep the provider subtle and the model id
 *  crisp, mirroring how the model selector surfaces them. */
const modelTitle = computed(() => {
  const m = view.value?.model;
  if (!m) return "";
  return m.name && m.name !== m.id ? `${m.provider} / ${m.name}` : `${m.provider} / ${m.id}`;
});
</script>

<template>
  <div class="right-panel__pane context-pane" role="tabpanel" aria-label="context">
    <div v-if="!hasData" class="ui-empty-state">
      <p>Context</p>
      <span>Send a message to see live token usage and session stats.</span>
    </div>

    <div v-else class="context-pane__body">
      <header class="context-pane__header">
        <div class="context-pane__model" :title="modelTitle || undefined">
          <span class="context-pane__model-provider">{{ view?.model?.provider ?? "" }}</span>
          <span v-if="view?.model" class="context-pane__model-sep">/</span>
          <span class="context-pane__model-id">{{ view?.model?.id ?? "" }}</span>
        </div>
        <div v-if="view?.modified" class="context-pane__date">{{ view.modified }}</div>
      </header>

      <section class="context-pane__section">
        <h3 class="context-pane__heading ui-section-title">Context</h3>
        <div class="context-pane__stat">
          <span class="context-pane__value">{{ view?.context.tokensText ?? "—" }}</span>
          <span class="context-pane__sub">{{ view?.context.percent ?? "—" }} used</span>
        </div>
        <div
          v-if="view?.context.contextWindow && view.context.tokens != null"
          class="context-pane__bar"
          role="progressbar"
          :aria-valuenow="view.context.tokens"
          :aria-valuemin="0"
          :aria-valuemax="view.context.contextWindow"
        >
          <div
            class="context-pane__bar-fill"
            :style="{ width: `${Math.min(100, (view.context.tokens / view.context.contextWindow) * 100)}%` }"
          />
        </div>
      </section>

      <section class="context-pane__section">
        <h3 class="context-pane__heading ui-section-title">Messages</h3>
        <div class="context-pane__stat">
          <span class="context-pane__value">{{ view?.messages.totalText ?? "0" }}</span>
        </div>
        <div class="context-pane__row">
          <span class="context-pane__row-label">User</span>
          <span class="context-pane__row-value">{{ view?.messages.userText ?? "0" }}</span>
        </div>
        <div class="context-pane__row">
          <span class="context-pane__row-label">Assistant</span>
          <span class="context-pane__row-value">{{ view?.messages.assistantText ?? "0" }}</span>
        </div>
      </section>

      <section class="context-pane__section">
        <h3 class="context-pane__heading ui-section-title">Cost</h3>
        <div class="context-pane__stat">
          <span class="context-pane__value">{{ view?.cost.value ?? "$0.00" }}</span>
        </div>
      </section>

      <section class="context-pane__section">
        <h3 class="context-pane__heading ui-section-title">Last Assistant Message</h3>
        <div v-for="row in usageRows" :key="row.label" class="context-pane__row">
          <span class="context-pane__row-label">{{ row.label }}</span>
          <span class="context-pane__row-value">{{ row.value }}</span>
        </div>
      </section>

      <section class="context-pane__section">
        <h3 class="context-pane__heading ui-section-title">Cache Hit</h3>
        <div class="context-pane__stat">
          <span class="context-pane__value">{{ view?.cacheHit ?? "0.0%" }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.context-pane__body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 18px 16px 20px;
  overflow-y: auto;
}

.context-pane__header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.context-pane__model {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--ui-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-pane__model-provider {
  color: var(--ui-text-strong);
}

.context-pane__model-sep {
  color: #b9b9b9;
}

.context-pane__model-id {
  color: var(--ui-text-muted);
  font-family: var(--ui-font-mono);
  font-size: 12.5px;
}

.context-pane__date {
  color: var(--ui-text-muted);
  font-size: 11.5px;
}

.context-pane__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.context-pane__heading {
  margin-bottom: 4px;
}

.context-pane__stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.context-pane__value {
  color: var(--ui-text-strong);
  font-family: var(--ui-font-mono);
  font-size: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.context-pane__sub {
  color: var(--ui-text-muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.context-pane__bar {
  height: 4px;
  margin-top: 8px;
  border-radius: 999px;
  background: var(--ui-surface-selected);
  overflow: hidden;
}

.context-pane__bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #b4b4b4, #6f6f6f);
  transition: width 200ms ease;
}

.context-pane__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 1px 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.context-pane__row-label {
  color: var(--ui-text-muted);
}

.context-pane__row-value {
  color: var(--ui-text-strong);
  font-family: var(--ui-font-mono);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
</style>
