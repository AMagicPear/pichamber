<script setup lang="ts">
const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

withDefaults(
  defineProps<{
    label: string;
    size?: "mini" | "compact" | "standard" | "large";
    pressed?: boolean;
    disabled?: boolean;
    /** Color tone override. `danger` tints the icon red (for stop/cancel)
     *  while keeping the ghost-outline body — no filled background. */
    tone?: "danger";
  }>(),
  {
    size: "standard",
    pressed: undefined,
    disabled: false,
    tone: undefined,
  },
);
</script>

<template>
  <button type="button" class="icon-button" :class="[
    `icon-button--${size}`,
    { 'is-pressed': pressed === true },
    tone && `icon-button--tone-${tone}`,
  ]" :aria-label="label" :title="label" :aria-pressed="pressed" :disabled="disabled" @click="emit('click', $event)">
    <slot />
  </button>
</template>

<style scoped>
.icon-button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition:
    background-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard),
    color var(--ui-duration-fast) var(--ui-ease-standard),
    transform 80ms ease;
}

/** Slot icons are Lucide-style with `viewBox` preserved (vite-svg-loader's
 *  svgo runs with `removeViewBox` disabled in vite.config.ts), so CSS
 *  width/height scales the icon's user units into the icon-button's box.
 *  Per-variant sizing lives next to each size's button-size rule below. */
.icon-button :deep(svg) {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.icon-button--mini {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: var(--ui-text-muted);
}

.icon-button--mini :deep(svg) {
  width: 13px;
  height: 13px;
}

.icon-button--mini:hover:not(:disabled),
.icon-button--mini:focus-visible {
  box-shadow: none;
  color: var(--ui-text-strong);
}

.icon-button--mini.icon-button--tone-danger {
  color: var(--ui-error-strong);
}

.icon-button--compact {
  width: 24px;
  height: 24px;
}

.icon-button--compact :deep(svg) {
  width: 16px;
  height: 16px;
}

.icon-button--standard {
  width: 28px;
  height: 28px;
}

.icon-button--large {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.icon-button--large :deep(svg) {
  width: 22px;
  height: 22px;
}

.icon-button:hover:not(:disabled) {
  background: var(--ui-surface-hover);
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
}

.icon-button:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
  background: var(--ui-surface-hover);
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
}

.icon-button:active:not(:disabled) {
  transform: scale(0.94);
}

.icon-button.is-pressed {
  color: var(--ui-panel-active);
}

.icon-button:disabled {
  cursor: default;
  opacity: 0.45;
}

/* Danger tone: red icon, no fill — matches the rest of the ghost
 * outline buttons in shape, only the color signals "stop / cancel". */
.icon-button--tone-danger {
  color: var(--ui-error-strong);
}

.icon-button--tone-danger:hover:not(:disabled) {
  background: var(--ui-error-hover);
}
</style>
