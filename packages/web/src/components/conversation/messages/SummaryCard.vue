<script setup lang="ts">
/** Quiet inset card shared by CompactionSummaryMessage and
 *  CustomSummaryMessage. The regular variant marks a compaction block;
 *  the compact variant uses the same restrained surface treatment as
 *  other inline message metadata. */
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
  color: var(--ui-text-secondary);
}
.summary-card--regular {
  padding: 12px 16px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  background: var(--ui-surface-muted);
}
.summary-card--compact {
  padding: 8px 12px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
  font-size: 13px;
}
.summary-card--regular { font-size: 14px; }
.summary-card__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.summary-card--regular .summary-card__header { margin-bottom: 6px; }
.summary-card--compact .summary-card__header { margin-bottom: 4px; }
</style>
