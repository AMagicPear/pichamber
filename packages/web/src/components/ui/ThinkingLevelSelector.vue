<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { computed } from "vue";
import AiGenerate2Icon from "lucide-static/icons/sparkles.svg";
import SelectorPopover from "@/components/ui/SelectorPopover.vue";
import MenuPanel from "@/components/ui/MenuPanel.vue";

const props = defineProps<{
  level: ThinkingLevel;
  availableLevels: ThinkingLevel[];
}>();

const emit = defineEmits<{
  select: [level: ThinkingLevel];
}>();

const labels: Record<ThinkingLevel, string> = {
  off: "Off",
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

const groups = computed(() => [{
  id: "levels",
  items: visibleLevels.value.map((level) => ({
    id: level,
    label: labels[level],
    value: level,
    active: level === props.level,
  })),
}]);

const onSelect = (item: { value: ThinkingLevel }, close: () => void) => {
  emit("select", item.value);
  close();
};
</script>

<template>
  <SelectorPopover
    class="thinking-selector"
    :width="104"
    :panel-width="104"
    :panel-min-width="104"
    :trigger-style="{
      '--selector-popover-trigger-color': 'var(--ui-thinking-text)',
    }"
    :panel-style="{
      '--menu-item-active-bg': 'var(--ui-accent-soft)',
      '--menu-item-active-color': 'var(--ui-accent-text)',
    }"
  >
    <template #trigger-icon><AiGenerate2Icon /></template>
    <template #trigger-label>{{ currentLabel }}</template>
    <template #default="{ close }">
      <MenuPanel :groups="groups" item-role="option" @select="onSelect($event, close)" />
    </template>
  </SelectorPopover>
</template>
