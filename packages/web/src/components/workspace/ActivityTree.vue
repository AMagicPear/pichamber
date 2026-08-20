<script setup lang="ts">
import type { ActivityNode } from "@pichamber/shared";

defineProps<{ node: ActivityNode }>();
</script>

<template>
  <div class="activity-tree__node">
    <div class="activity-tree__row">
      <span class="activity-tree__branch" :data-state="node.state" aria-hidden="true" />
      <div class="activity-tree__copy">
        <div class="activity-tree__label">{{ node.label }}</div>
      </div>
      <div class="activity-tree__meta">
        <span class="activity-tree__state">{{ node.state }}</span>
        <span v-if="node.activity?.currentTool" class="activity-tree__activity">{{ node.activity.currentTool }}</span>
        <span v-else-if="node.activity?.toolCount" class="activity-tree__activity">{{ node.activity.toolCount }} tools</span>
      </div>
    </div>
    <div v-if="node.children?.length" class="activity-tree__children">
      <ActivityTree v-for="child in node.children" :key="child.id" :node="child" />
    </div>
  </div>
</template>

<style scoped>
/* Lays rows out the same way as a composer-shelf row: a small leading
 * marker, the label that takes the rest of the space, then right-aligned
 * state and activity text. Status color is the only signal — no icons,
 * no extra weight, no nested cards. */
.activity-tree__node { min-width: 0; }
.activity-tree__row { display: grid; min-width: 0; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 8px; padding: 5px 7px; border-radius: 6px; }
.activity-tree__row:hover { background: var(--ui-surface-hover); }
.activity-tree__branch { width: 6px; height: 6px; flex: 0 0 6px; margin-top: 6px; border-radius: 50%; background: var(--ui-text-tertiary); }
.activity-tree__branch[data-state="running"] { background: var(--ui-status-text); animation: activity-pulse 1.4s ease-in-out infinite; }
.activity-tree__branch[data-state="complete"] { background: var(--ui-status-text); opacity: 0.7; }
.activity-tree__branch[data-state="failed"], .activity-tree__branch[data-state="rejected"] { background: var(--ui-text-muted); box-shadow: inset 0 0 0 1px var(--ui-border-focus); }
.activity-tree__copy { min-width: 0; }
.activity-tree__label { min-width: 0; overflow-wrap: anywhere; color: var(--ui-text); font-size: 13px; line-height: 1.35; }
.activity-tree__meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 3px 9px; min-width: 110px; margin-top: 2px; color: var(--ui-text-muted); font-size: 11px; line-height: 1.25; text-align: right; }
.activity-tree__state { flex: 0 0 auto; }
.activity-tree__state:empty { display: none; }
.activity-tree__activity { min-width: 0; overflow-wrap: anywhere; }
.activity-tree__meta > :not(:first-child)::before { content: "·"; margin-right: 9px; color: var(--ui-border-focus); }
.activity-tree__children { margin-left: 14px; }
@keyframes activity-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .activity-tree__branch[data-state="running"] { animation: none; } }
</style>
