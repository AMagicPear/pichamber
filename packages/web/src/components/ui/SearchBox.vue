<script setup lang="ts">
import CloseIcon from "lucide-static/icons/x.svg";
import SearchIcon from "lucide-static/icons/search.svg";
import IconButton from "@/components/ui/IconButton.vue";
import { onMounted, ref } from "vue";

const modelValue = defineModel<string>({ required: true });

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    label?: string;
    type?: "text" | "search" | "password";
    autoFocus?: boolean;
    disabled?: boolean;
    /** Show the × clear button when the input is non-empty. */
    clearable?: boolean;
    /** Compact height (matches --ui-row-height). Default uses --ui-input-height. */
    size?: "default" | "compact";
  }>(),
  { type: "search", clearable: true, size: "default" },
);

const emit = defineEmits(["enter"]);

const inputEl = ref<HTMLInputElement | null>(null);

onMounted(() => {
  if (props.autoFocus && inputEl.value) inputEl.value.focus();
});

const clear = () => {
  modelValue.value = "";
};

defineExpose({
  focus: () => inputEl.value?.focus(),
  select: () => inputEl.value?.select(),
  blur: () => inputEl.value?.blur(),
});
</script>

<template>
  <div class="search-box" :class="[`is-${size}`, { 'is-disabled': disabled }]">
    <span v-if="type === 'search'" class="search-box__icon" aria-hidden="true">
      <SearchIcon />
    </span>
    <input
      ref="inputEl"
      v-model="modelValue"
      :type="type"
      :placeholder="placeholder"
      :aria-label="label"
      :autofocus="autoFocus"
      :disabled="disabled"
      class="search-box__input"
      @keydown.enter="emit('enter')"
    />
    <IconButton
      v-if="clearable && modelValue && !disabled"
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
  align-items: center;
  gap: 6px;
  height: var(--ui-input-height);
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface-subtle);
  box-sizing: border-box;
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    background-color var(--ui-duration-fast) var(--ui-ease-standard);
}
.search-box.is-compact {
  height: var(--ui-row-height);
}
.search-box:focus-within {
  border-color: var(--ui-border-focus);
  background: var(--ui-surface);
}
.search-box.is-disabled {
  opacity: 0.6;
  cursor: default;
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
.search-box__input {
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
.search-box__input::-webkit-search-cancel-button {
  display: none;
  appearance: none;
}
.search-box__input::placeholder {
  color: var(--ui-text-muted);
}
.search-box__input:disabled {
  cursor: default;
}
</style>