<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string;
  }>(),
  { modelValue: undefined },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<template>
  <select
    :value="modelValue"
    v-bind="$attrs"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <slot />
  </select>
</template>

<style scoped>
select {
  height: 30px;
  min-width: 150px;
  padding: 0 7px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  outline: 0;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 12px;
}
select:disabled {
  cursor: default;
  opacity: 0.55;
}
</style>
