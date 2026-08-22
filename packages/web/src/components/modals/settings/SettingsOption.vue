<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description: string;
    inline?: boolean;
  }>(),
  { inline: false },
);
</script>

<template>
  <label class="settings-option" :class="{ 'settings-option--inline': inline }">
    <span v-if="!inline" class="settings-option__control"><slot /></span>
    <span class="settings-option__copy"><strong>{{ title }}</strong><small>{{ description }}</small></span>
    <span v-if="inline" class="settings-option__control"><slot /></span>
  </label>
</template>

<style scoped>
.settings-option { display: flex; max-width: 560px; align-items: flex-start; gap: 10px; padding: 14px 0; color: var(--ui-text-strong); cursor: pointer; }
.settings-option--inline { width: 100%; max-width: 720px; justify-content: space-between; gap: 24px; }
.settings-option__copy { display: grid; min-width: 0; gap: 4px; }
.settings-option__copy strong { font-weight: 500; }
.settings-option__copy small { color: var(--ui-text-muted); font-size: 12px; }
.settings-option__control { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 20px; }
.settings-option:not(.settings-option--inline) .settings-option__control { margin-top: 2px; }
.settings-option :deep(input[type="checkbox"]) { width: 16px; height: 16px; margin: 0; accent-color: var(--ui-text-strong); }
.settings-option :deep(select), .settings-option :deep(input[type="number"]) { height: 30px; min-width: 150px; padding: 0 7px; border: 1px solid var(--ui-border); border-radius: 5px; outline: 0; background: var(--ui-surface); color: var(--ui-text); font: inherit; font-size: 12px; }
.settings-option :deep(input[type="number"]) { width: 130px; }
.settings-option :deep(input:disabled), .settings-option :deep(select:disabled) { cursor: default; opacity: 0.55; }
@media (max-width: 640px) { .settings-option--inline { align-items: flex-start; flex-direction: column; gap: 8px; } }
</style>
