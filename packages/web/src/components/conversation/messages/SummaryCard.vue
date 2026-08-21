<script setup lang="ts">
/** Quiet inset card shared by CompactionSummaryMessage and
 *  CustomSummaryMessage — both want a left-accent border, muted
 *  background, and rounded corners. Visual variant differs in padding
 *  and font size: `regular` matches the larger compaction block,
 *  `compact` matches the smaller custom / branch-summary block. */
defineProps<{
  size?: "compact" | "regular";
}>();
</script>

<template>
  <div class="summary-card" :class="`summary-card--${size ?? 'regular'}`">
    <div v-if="$slots.header" class="summary-card__header">
      <slot name="header" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.summary-card {
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-secondary);
}
.summary-card--regular { padding: 12px 16px; font-size: 14px; }
.summary-card--compact { padding: 10px 14px; font-size: 13px; }
.summary-card__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.summary-card--regular .summary-card__header { margin-bottom: 6px; }
.summary-card--compact .summary-card__header { margin-bottom: 4px; }
</style>
