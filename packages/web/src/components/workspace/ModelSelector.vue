<script setup lang="ts">
import { computed, ref } from "vue";
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";
import type { ModelDescriptor } from "@pichamber/shared";
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
  panel: ".model-selector__panel",
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
  <div ref="root" class="model-selector" :class="{ 'is-open': open }">
    <button
      type="button"
      class="model-selector__trigger"
      :disabled="disabled || availableModels.length === 0"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <ProviderLogo class="model-selector__icon" :provider-id="model?.provider ?? ''" :size="16" />
      <span class="model-selector__name">{{ placeholder }}</span>
      <ArrowDownSIcon class="model-selector__chevron" />
    </button>

    <Teleport v-if="open" to="body">
      <div class="model-selector__panel" role="listbox" :style="style">
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
              class="model-selector__item"
              role="option"
              :aria-selected="model?.provider === candidate.provider && model?.id === candidate.id"
              :class="{ 'is-active': model?.provider === candidate.provider && model?.id === candidate.id }"
              @click="onSelect(candidate)"
            >
              <ProviderLogo class="model-selector__item-icon" :provider-id="candidate.provider" :size="16" />
              <span class="model-selector__item-name">{{ candidate.name }}</span>
            </button>
          </div>
          <div v-if="grouped.length === 0" class="model-selector__empty">No matches.</div>
        </div>
      </div>
    </Teleport>
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

/* The panel is teleported to <body>. Scoped CSS still rewrites class
 * attribute selectors, so the rule below keeps matching after teleport.
 *
 * height is set both here (as the floor) and inline by `popoverStyle`
 * (as the live value) — the inline value wins. Keeping `max-height` so
 * tiny viewports don't push it off-screen. */
.model-selector__panel {
  z-index: 1000;
  display: flex;
  flex-direction: column;
  width: 360px;
  height: 360px;
  max-height: calc(100vh - 80px);
  overflow: hidden;
  border: 1px solid #e2dfd5;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}
.model-selector__search {
  flex: 0 0 auto;
  padding: 8px;
  border-bottom: 1px solid #efece4;
}
.model-selector__search input {
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #e2dfd5;
  border-radius: 6px;
  outline: 0;
  font: inherit;
  font-size: 13px;
  background: #fff;
}
.model-selector__search input:focus {
  border-color: #3978d4;
}
.model-selector__list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
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
.model-selector__item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.model-selector__item:hover {
  background: rgb(0 0 0 / 5%);
}
.model-selector__item.is-active {
  background: rgb(57 120 212 / 12%);
  color: #1f3a6b;
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
  padding: 14px 8px;
  color: #888;
  font-size: 13px;
  text-align: center;
}
</style>
