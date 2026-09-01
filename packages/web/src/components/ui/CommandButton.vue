<script setup lang="ts">
withDefaults(defineProps<{
  variant?: "outline" | "compact";
  danger?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}>(), {
  variant: "outline",
  danger: false,
  disabled: false,
  type: "button",
});
</script>

<template>
  <button
    :type="type"
    class="command-button"
    :class="[`command-button--${variant}`, { 'command-button--danger': danger }]"
    :disabled="disabled"
  ><slot /></button>
</template>

<style scoped>
.command-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--ui-duration-fast) var(--ui-ease-standard), border-color var(--ui-duration-fast) var(--ui-ease-standard), color var(--ui-duration-fast) var(--ui-ease-standard), transform var(--ui-duration-fast) var(--ui-ease-standard);
}
.command-button--outline {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-surface);
  color: var(--ui-text-strong);
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 1px 2px rgb(16 15 15 / 4%);
}
.command-button--compact {
  min-height: 27px;
  padding: 3px 10px;
  border-radius: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
}
.command-button--outline:hover:not(:disabled) { border-color: var(--ui-panel-active); background: var(--ui-surface-hover); }
.command-button--compact:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.command-button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.command-button:active:not(:disabled) { transform: translateY(1px); }
.command-button:disabled { cursor: default; opacity: 0.5; }
.command-button--danger { color: var(--ui-error-strong); }
.command-button--danger.command-button--outline { border-color: var(--ui-error-border); }
.command-button--danger:hover:not(:disabled) { border-color: var(--ui-error-border); background: var(--ui-error-hover); color: var(--ui-error-strong); }
</style>
