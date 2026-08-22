<script setup lang="ts">
/* Pure presentation button. The activity feature owns its own open
 * state inside ActivityPanel, so the toggle just renders a button and
 * emits `toggle` when clicked — no refs, no logic. */
import ArrowUpIcon from "lucide-static/icons/chevron-up.svg";
import StackIcon from "@/assets/icons/Stack.svg";

defineProps<{
  count: number;
  /** Reflected onto `aria-expanded` for assistive tech. ActivityPanel
   *  passes the current `open` value through the trigger slot scope. */
  expanded: boolean;
}>();

defineEmits<{
  toggle: [];
}>();

</script>

<template>
  <button
    type="button"
    class="activity-toggle activity-panel__trigger"
    :class="{ 'is-expanded': expanded }"
    :aria-expanded="expanded"
    :aria-controls="expanded ? 'activity-panel-surface' : undefined"
    @click="$emit('toggle')"
  >
    <StackIcon aria-hidden="true" />
    <span class="activity-toggle__label">Activity</span>
    <span class="activity-toggle__count">{{ count }}</span>
    <ArrowUpIcon aria-hidden="true" class="activity-toggle__chevron" />
  </button>
</template>

<style scoped>
.activity-toggle {
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  gap: 4px;
  padding: 1px 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: inherit;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.activity-toggle:hover {
  border-color: var(--ui-border-subtle);
  background: var(--ui-surface-hover);
  color: var(--ui-text);
}
.activity-toggle:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 1px;
}
.activity-toggle.is-expanded {
  border-color: var(--ui-border-subtle);
  background: var(--ui-accent-soft);
  color: var(--ui-accent-text);
}
.activity-toggle svg {
  width: 13px;
  height: 13px;
}
.activity-toggle__chevron {
  width: 12px;
  height: 12px;
  transition: transform 140ms ease;
}
/* The icon asset points up by default: collapsed points toward the
 * hidden card, expanded points down toward the open card. */
.activity-toggle.is-expanded .activity-toggle__chevron { transform: rotate(180deg); }
.activity-toggle__label {
  max-width: 28ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.activity-toggle__count {
  min-width: 10px;
  color: var(--ui-text-tertiary);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
</style>
