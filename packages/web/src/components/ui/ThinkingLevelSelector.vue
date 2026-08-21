<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { computed, ref } from "vue";
import AiGenerate2Icon from "@/assets/icons/AiGenerate2.svg";
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";
import MenuPanel from "@/components/ui/MenuPanel.vue";
import { usePopover } from "@/composables/usePopover";

const props = defineProps<{
  level: ThinkingLevel;
  availableLevels: ThinkingLevel[];
}>();

const emit = defineEmits<{
  select: [level: ThinkingLevel];
}>();

const root = ref<HTMLElement | null>(null);

const { open, style, close, toggle } = usePopover({
  root,
  trigger: ".thinking-selector__trigger",
  panel: ".menu-panel",
  width: 156,
  // 8px panel padding + one 28px row per level (used only for flip math;
  // the panel sizes itself).
  height: () => 8 + visibleLevels.value.length * 28,
});

const labels: Record<ThinkingLevel, string> = {
  off: "Build",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

const visibleLevels = computed<ThinkingLevel[]>(() =>
  // Always offer "off" so the user can opt out of reasoning, even when
  // the model doesn't expose a thinking-level ladder. The explicit return
  // type is required because Array.from() widens the Set iterator to
  // `string`, which Vue's template would then trip over.
  Array.from(new Set<ThinkingLevel>([...props.availableLevels, "off"])),
);

const currentLabel = computed(() => labels[props.level] ?? props.level);

const onSelect = (next: ThinkingLevel) => {
  emit("select", next);
  close();
};
</script>

<template>
  <div ref="root" class="thinking-selector">
    <button
      type="button"
      class="thinking-selector__trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <AiGenerate2Icon class="thinking-selector__icon" />
      <span class="thinking-selector__label">{{ currentLabel }}</span>
      <ArrowDownSIcon class="thinking-selector__chevron" />
    </button>
    <MenuPanel
      :open="open"
      :style="{
        ...style,
        '--menu-item-active-bg': 'var(--ui-accent-soft)',
        '--menu-item-active-color': 'var(--ui-accent-text)',
      }"
      role="listbox"
    >
      <button
        v-for="level in visibleLevels"
        :key="level"
        type="button"
        class="menu-item menu-item--split"
        role="option"
        :aria-selected="level === props.level"
        :class="{ 'is-active': level === props.level }"
        @click="onSelect(level)"
      >
        <span>{{ labels[level] }}</span>
        <span class="menu-item__hint">{{ level }}</span>
      </button>
    </MenuPanel>
  </div>
</template>

<style scoped>
.thinking-selector {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.thinking-selector__trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 170px;
  height: 26px;
  padding: 0 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-thinking-text);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--ui-duration-fast) var(--ui-ease-standard), color var(--ui-duration-fast) var(--ui-ease-standard);
}
.thinking-selector__trigger:hover {
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}
.thinking-selector__trigger[aria-expanded="true"] {
  background: var(--ui-accent-soft);
  color: var(--ui-accent-text);
}
.thinking-selector__icon {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  opacity: 0.72;
}
.thinking-selector__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thinking-selector__chevron {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  opacity: 0.55;
}
</style>
