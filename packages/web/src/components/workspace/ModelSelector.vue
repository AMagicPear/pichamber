<script setup lang="ts">
import { computed, ref } from "vue";
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";
import type { ModelDescriptor } from "@pichamber/shared";
import MenuPanel from "@/components/MenuPanel.vue";
import ProviderLogo from "./ProviderLogo";
import { usePopover } from "@/composables/usePopover";

const props = defineProps<{
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [model: ModelDescriptor];
}>();

const root = ref<HTMLElement | null>(null);
const search = ref("");
const searchInput = ref<HTMLInputElement | null>(null);

const { open, style, close: closePopover, toggle } = usePopover({
  root,
  trigger: ".model-selector__trigger",
  panel: ".menu-panel",
  width: 360,
  height: 360,
  onOpen: () => searchInput.value?.focus(),
});

/** Closing also resets the filter so the next open starts fresh. */
const close = () => {
  search.value = "";
  closePopover();
};

/** Group available models by provider, keeping the current selection
 *  pinned at the top of its bucket so it stays visible after a search. */
const grouped = computed(() => {
  const term = search.value.trim().toLowerCase();
  const buckets = new Map<string, ModelDescriptor[]>();
  for (const candidate of props.availableModels) {
    if (
      term &&
      !candidate.name.toLowerCase().includes(term) &&
      !candidate.id.toLowerCase().includes(term) &&
      !candidate.provider.toLowerCase().includes(term)
    ) {
      continue;
    }
    const bucket = buckets.get(candidate.provider) ?? [];
    bucket.push(candidate);
    buckets.set(candidate.provider, bucket);
  }
  const result = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  return result;
});

const onSelect = (next: ModelDescriptor) => {
  emit("select", next);
  close();
};

const placeholder = computed(() => {
  if (props.availableModels.length === 0) return "No models available";
  return props.model?.name ?? "Choose model";
});
</script>

<template>
  <div ref="root" class="model-selector">
    <button
      type="button"
      class="model-selector__trigger"
      :disabled="disabled || availableModels.length === 0"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <ProviderLogo class="model-selector__icon" :provider-id="model?.provider ?? ''" :model-id="model?.id ?? ''" :size="16" />
      <span class="model-selector__name">{{ placeholder }}</span>
      <ArrowDownSIcon class="model-selector__chevron" />
    </button>

    <MenuPanel
      :open="open"
      :style="style"
      :width="360"
      :height="360"
      role="listbox"
    >
      <div class="model-selector__search">
        <input
          ref="searchInput"
          v-model="search"
          type="text"
          placeholder="Filter models…"
          aria-label="Filter models"
          @keydown.esc="close"
        />
      </div>
      <div class="model-selector__list">
        <div v-for="[provider, models] in grouped" :key="provider" class="model-selector__group">
          <div class="model-selector__group-title">{{ provider }}</div>
          <button
            v-for="candidate in models"
            :key="`${candidate.provider}/${candidate.id}`"
            type="button"
            class="menu-item"
            role="option"
            :aria-selected="model?.provider === candidate.provider && model?.id === candidate.id"
            :class="{ 'is-active': model?.provider === candidate.provider && model?.id === candidate.id }"
            @click="onSelect(candidate)"
          >
            <ProviderLogo class="model-selector__item-icon" :provider-id="candidate.provider" :model-id="candidate.id" :size="16" />
            <span class="model-selector__item-name">{{ candidate.name }}</span>
          </button>
        </div>
        <div v-if="grouped.length === 0" class="model-selector__empty">No matches.</div>
      </div>
    </MenuPanel>
  </div>
</template>

<style scoped>
.model-selector {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.model-selector__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 240px;
  height: 32px;
  padding: 0 8px 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.model-selector__trigger:hover:not(:disabled) {
  background: rgb(0 0 0 / 5%);
}
.model-selector__trigger:disabled {
  cursor: default;
  opacity: 0.55;
}
.model-selector__icon {
  flex: 0 0 16px;
}
.model-selector__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-selector__chevron {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  opacity: 0.55;
}

/* The shared MenuPanel sizes the 360×360 box via the width/height props.
   Search box styling matches FileRefPicker's (@ picker). */
.model-selector__search {
  flex: 0 0 auto;
  padding: 8px;
  border-bottom: 1px solid #ededed;
}
.model-selector__search input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e7e4dc;
  border-radius: 8px;
  outline: 0;
  font: inherit;
  font-size: 13px;
  background: #fafaf7;
  transition: border-color 120ms ease;
}
.model-selector__search input:focus {
  border-color: #bcbcbc;
  background: #fff;
}
.model-selector__search input::placeholder {
  color: #999;
}
.model-selector__list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}
.model-selector__group {
  margin-bottom: 4px;
}
.model-selector__group-title {
  padding: 6px 8px 2px;
  color: #888;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.model-selector__item-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-selector__item-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}
.model-selector__empty {
  padding: 14px;
  color: #888;
  font-size: 13px;
  text-align: center;
}
</style>
