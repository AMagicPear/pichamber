<script setup lang="ts">
import ArchiveIcon from "lucide-static/icons/archive.svg";
import GitBranchIcon from "lucide-static/icons/git-branch.svg";
import MessageSquareTextIcon from "lucide-static/icons/message-square-text.svg";

/** Shared summary surface. Its type badge follows the Skill chip pattern so
 * compaction, custom, and branch summaries read as one message family. */
defineProps<{
  kind: "compaction" | "custom" | "branchSummary";
  label: string;
  meta?: string;
}>();
</script>

<template>
  <div class="summary-card">
    <header class="summary-card__header">
      <span class="summary-card__badge">
        <ArchiveIcon v-if="kind === 'compaction'" class="summary-card__icon" aria-hidden="true" />
        <MessageSquareTextIcon v-else-if="kind === 'custom'" class="summary-card__icon" aria-hidden="true" />
        <GitBranchIcon v-else class="summary-card__icon" aria-hidden="true" />
        <span>{{ label }}</span>
      </span>
      <span v-if="meta" class="summary-card__meta">{{ meta }}</span>
    </header>
    <slot />
  </div>
</template>

<style scoped>
.summary-card {
  padding: 8px 12px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
  color: var(--ui-text-secondary);
  font-size: 13px;
}
.summary-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.summary-card__badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--ui-skill-bg);
  color: var(--ui-skill-fg);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.summary-card__icon {
  flex: 0 0 11px;
  width: 11px;
  height: 11px;
}
.summary-card__meta {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
