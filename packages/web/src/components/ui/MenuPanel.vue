<script setup lang="ts" generic="T">
import { computed, nextTick, ref, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import SearchBox from "@/components/ui/SearchBox.vue";

const { t } = useI18n();
type MenuItem<T> = {
  id: string;
  label: string;
  value: T;
  icon?: Component | string;
  active?: boolean;
  disabled?: boolean;
  meta?: string;
  searchText?: string;
};

type MenuGroup<T> = {
  id: string;
  label?: string;
  items: MenuItem<T>[];
};

const props = withDefaults(defineProps<{
  groups: MenuGroup<T>[];
  open?: boolean;
  filterable?: boolean;
  filterPlaceholder?: string;
  emptyText?: string;
  itemRole?: string;
}>(), {
  open: false,
  filterable: false,
  itemRole: "menuitem",
});

const emit = defineEmits<{
  select: [item: MenuItem<T>];
}>();

const filter = ref("");
const filterInput = ref<InstanceType<typeof SearchBox> | null>(null);

const normalizedFilter = computed(() => filter.value.trim().toLocaleLowerCase());

const matchesFilter = (item: MenuItem<T>) => {
  if (!normalizedFilter.value) return true;
  return `${item.label} ${item.searchText ?? ""}`.toLocaleLowerCase().includes(normalizedFilter.value);
};

const visibleGroups = computed(() => props.groups
  .map((group) => ({ ...group, items: group.items.filter(matchesFilter) }))
  .filter((group) => group.items.length > 0));

watch(() => props.open, async (open) => {
  if (!open) {
    filter.value = "";
    return;
  }
  if (props.filterable) {
    await nextTick();
    filterInput.value?.focus();
  }
});

const select = (item: MenuItem<T>) => {
  if (!item.disabled) emit("select", item);
};
</script>

<template>
  <div class="menu-panel">
    <div v-if="filterable" class="menu-panel__filter">
      <SearchBox
        ref="filterInput"
        v-model="filter"
        type="text"
        :placeholder="filterPlaceholder ?? t('menu.filter')"
        :label="t('menu.filterLabel')"
      />
    </div>
    <div class="menu-panel__list">
      <template v-for="group in visibleGroups" :key="group.id">
        <div v-if="group.label" class="menu-panel__group-title">{{ group.label }}</div>
        <button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          class="menu-panel__item"
          :class="{ 'is-active': item.active }"
          :role="itemRole"
          :disabled="item.disabled"
          :aria-selected="itemRole === 'option' ? item.active : undefined"
          @click="select(item)"
        >
          <slot name="item-icon" :item="item">
            <component v-if="item.icon" :is="item.icon" class="menu-panel__item-icon" />
          </slot>
          <span class="menu-panel__item-label">{{ item.label }}</span>
          <span v-if="item.meta" class="menu-panel__item-meta">{{ item.meta }}</span>
        </button>
      </template>
      <div v-if="visibleGroups.length === 0" class="menu-panel__empty">{{ emptyText ?? t('menu.noMatches') }}</div>
    </div>
  </div>
</template>

<style scoped>
.menu-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}
.menu-panel__filter {
  flex: 0 0 auto;
  padding: 8px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.menu-panel__filter > .search-box {
  background: var(--ui-surface);
}
.menu-panel__list {
  /* `auto` preserves the list's intrinsic height in content-driven panels,
   * while still allowing it to shrink and scroll inside a fixed-height one. */
  flex: 1 1 auto;
  min-height: 0;
  padding: 2px;
  overflow-y: auto;
}
.menu-panel__group-title {
  padding: 6px 8px 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.menu-panel__item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu-panel__item:hover:not(:disabled) {
  background: var(--ui-surface-hover);
}
.menu-panel__item.is-active {
  background: var(--menu-item-active-bg, var(--ui-accent-soft));
  color: var(--menu-item-active-color, var(--ui-accent-text));
}
.menu-panel__item:disabled {
  cursor: default;
  opacity: 0.5;
}
.menu-panel__item:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: -2px;
}
.menu-panel__item-icon,
.menu-panel__item :deep(svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}
.menu-panel__item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-panel__item-meta {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-family: var(--ui-font-mono);
  font-size: 11px;
}
.menu-panel__empty {
  padding: 14px;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-align: center;
}
</style>
