<script setup lang="ts">
import CloseIcon from "@/assets/icons/Close.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import { onMounted, ref } from "vue";

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const inputEl = ref<HTMLInputElement | null>(null);

onMounted(() => {
  if (props.autoFocus && inputEl.value) inputEl.value.focus();
});

const onInput = (event: Event) => {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
};

const clear = () => emit("update:modelValue", "");
</script>

<template>
  <div class="search-box">
    <span class="search-box__icon">
      <SearchIcon />
    </span>
    <input
      ref="inputEl"
      :value="modelValue"
      type="search"
      :placeholder="placeholder"
      :aria-label="label"
      :autofocus="autoFocus"
      @input="onInput"
    />
    <button
      v-if="modelValue"
      type="button"
      class="search-box__clear"
      :aria-label="`Clear ${label ?? 'search'}`"
      :title="`Clear ${label ?? 'search'}`"
      @click="clear"
    >
      <CloseIcon />
    </button>
  </div>
</template>

<style scoped>
.search-box {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  height: var(--ui-input-height);
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface-subtle);
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    background-color var(--ui-duration-fast) var(--ui-ease-standard);
}
.search-box:focus-within {
  border-color: var(--ui-border-focus);
  background: var(--ui-surface);
}
.search-box__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}
.search-box__icon svg {
  display: block;
  width: 100%;
  height: 100%;
}
.search-box input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.search-box input::-webkit-search-cancel-button {
  display: none;
  appearance: none;
}
.search-box input::placeholder {
  color: var(--ui-text-muted);
}
.search-box__clear {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--ui-text-muted);
}
.search-box__clear:hover {
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}
.search-box__clear:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 1px;
}
.search-box__clear svg {
  width: 12px;
  height: 12px;
}
</style>
