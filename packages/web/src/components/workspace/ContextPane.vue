<script setup lang="ts">
import { computed } from "vue";
import type { LastAssistantUsage, SessionStatsView } from "@pichamber/shared";
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

const numberFormat = new Intl.NumberFormat("en-US");
const usageRows = computed(() => {
  const usage: LastAssistantUsage = view.value?.lastAssistant ?? {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  // Order matches the openchamber reference; reasoning sits between output
  // and cacheRead so the eye scans the production tokens first, then the
  // billing-relevant cache buckets.
  return [
    { label: "Input", value: usage.input },
    { label: "Output", value: usage.output },
    { label: "Reasoning", value: usage.reasoning },
    { label: "Cache Read", value: usage.cacheRead },
    { label: "Cache Write", value: usage.cacheWrite },
  ];
});

const formatTokens = (n: number) => numberFormat.format(n);

/** "OpenCode Zen / hy3-free" — keep the provider subtle and the model id
 *  crisp, mirroring how the model selector surfaces them. */
const modelTitle = computed(() => {
  const m = view.value?.model;
  if (!m) return "";
  return m.name && m.name !== m.id ? `${m.provider} / ${m.name}` : `${m.provider} / ${m.id}`;
});
</script>

<template>
  <div class="context-panel__pane context-pane" role="tabpanel" aria-label="context">
    <div v-if="!hasData" class="context-pane__empty">
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
        <h3 class="context-pane__heading">Context</h3>
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
        <h3 class="context-pane__heading">Messages</h3>
        <div class="context-pane__stat">
          <span class="context-pane__value">{{ formatTokens(view?.messages.total ?? 0) }}</span>
        </div>
        <div class="context-pane__row">
          <span class="context-pane__row-label">User</span>
          <span class="context-pane__row-value">{{ formatTokens(view?.messages.user ?? 0) }}</span>
        </div>
        <div class="context-pane__row">
          <span class="context-pane__row-label">Assistant</span>
          <span class="context-pane__row-value">{{ formatTokens(view?.messages.assistant ?? 0) }}</span>
        </div>
      </section>

      <section class="context-pane__section">
        <h3 class="context-pane__heading">Cost</h3>
        <div class="context-pane__stat">
          <span class="context-pane__value">{{ view?.cost.value ?? "$0.00" }}</span>
        </div>
      </section>

      <section class="context-pane__section">
        <h3 class="context-pane__heading">Last Assistant Message</h3>
        <div v-for="row in usageRows" :key="row.label" class="context-pane__row">
          <span class="context-pane__row-label">{{ row.label }}</span>
          <span class="context-pane__row-value">{{ formatTokens(row.value) }}</span>
        </div>
      </section>

      <section class="context-pane__section">
        <h3 class="context-pane__heading">Cache Hit</h3>
        <div class="context-pane__stat">
          <span class="context-pane__value">{{ view?.cacheHit ?? "0.0%" }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.context-pane {
  background: #fff;
}

.context-pane__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
}

.context-pane__empty p {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  color: #171717;
}

.context-pane__empty span {
  color: #777;
  font-size: 12px;
}

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
  border-bottom: 1px solid #ececec;
}

.context-pane__model {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #171717;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-pane__model-provider {
  color: #171717;
}

.context-pane__model-sep {
  color: #b9b9b9;
}

.context-pane__model-id {
  color: #555;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
}

.context-pane__date {
  color: #8a8a8a;
  font-size: 11.5px;
}

.context-pane__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.context-pane__heading {
  margin: 0 0 4px;
  color: #8a8a8a;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.context-pane__stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.context-pane__value {
  color: #171717;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.context-pane__sub {
  color: #8a8a8a;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.context-pane__bar {
  height: 4px;
  margin-top: 8px;
  border-radius: 999px;
  background: #f0eee7;
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
  color: #555;
  font-size: 12px;
}

.context-pane__row-label {
  color: #6f6f6f;
}

.context-pane__row-value {
  color: #171717;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
</style>
