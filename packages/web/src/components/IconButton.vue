<script setup lang="ts">
const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

withDefaults(
  defineProps<{
    label: string;
    size?: "compact" | "standard" | "large";
    pressed?: boolean;
    disabled?: boolean;
  }>(),
  {
    size: "standard",
    pressed: undefined,
    disabled: false,
  },
);
</script>

<template>
  <button
    type="button"
    class="icon-button"
    :class="`icon-button--${size}`"
    :aria-label="label"
    :title="label"
    :aria-pressed="pressed"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
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
    transform 80ms ease;
}
.icon-button--compact {
  width: 24px;
  height: 24px;
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
.icon-button:disabled {
  cursor: default;
  opacity: 0.45;
}
.icon-button :deep(svg) {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.icon-button--compact :deep(svg) {
  width: 16px;
  height: 16px;
}
</style>
