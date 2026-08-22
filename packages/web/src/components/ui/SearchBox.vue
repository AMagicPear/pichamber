<script setup lang="ts">
import CloseIcon from "@/assets/icons/Close.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import IconButton from "@/components/ui/IconButton.vue";
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
    <IconButton
      v-if="modelValue"
      class="search-box__clear"
      size="mini"
      :label="`Clear ${label ?? 'search'}`"
      @click="clear"
    >
      <CloseIcon />
    </IconButton>
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

</style>
