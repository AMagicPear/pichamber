<script setup lang="ts">
import { computed, ref } from "vue";
import ArrowDownSIcon from "lucide-static/icons/chevron-down.svg";
import FloatingPanel from "@/components/ui/FloatingPanel.vue";
import { usePopover } from "@/composables/usePopover";

defineOptions({ inheritAttrs: false });

type Size = number | (() => number);

const props = defineProps<{
  width?: Size;
  panelWidth?: number;
  panelMaxHeight?: number;
  panelMinWidth?: number;
  role?: string;
  ariaLabel?: string;
  disabled?: boolean;
  triggerStyle?: Record<string, string>;
  panelStyle?: Record<string, string>;
}>();

const emit = defineEmits<{
  open: [];
}>();

const root = ref<HTMLElement | null>(null);

const { open, style, close, toggle, panelId } = usePopover({
  root,
  trigger: "[data-selector-popover-trigger]",
  panel: ".floating-panel",
  width: props.width,
  onOpen: () => emit("open"),
});

const panelStyles = computed(() => ({ ...style.value, ...props.panelStyle }));
</script>

<template>
  <div ref="root" class="selector-popover" v-bind="$attrs">
    <button
      type="button"
      class="selector-popover__trigger"
      data-selector-popover-trigger
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :style="triggerStyle"
      @click="toggle"
    >
      <span class="selector-popover__icon"><slot name="trigger-icon" /></span>
      <span class="selector-popover__label"><slot name="trigger-label" /></span>
      <ArrowDownSIcon class="selector-popover__chevron" />
    </button>
    <FloatingPanel
      :open="open"
      :style="panelStyles"
      :width="panelWidth"
      :max-height="panelMaxHeight"
      :min-width="panelMinWidth"
      :panel-id="panelId"
      :role="role ?? 'listbox'"
      :aria-label="ariaLabel"
    >
      <slot :close="close" :open="open" />
    </FloatingPanel>
  </div>
</template>

<style scoped>
.selector-popover {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.selector-popover__trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 220px;
  height: 26px;
  padding: 0 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--selector-popover-trigger-color, inherit);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--ui-duration-fast) var(--ui-ease-standard), color var(--ui-duration-fast) var(--ui-ease-standard);
}
.selector-popover__trigger:hover:not(:disabled) {
  background: var(--ui-surface-hover);
  color: var(--selector-popover-trigger-hover-color, var(--ui-text-strong));
}
.selector-popover__trigger[aria-expanded="true"] {
  background: var(--selector-popover-trigger-open-bg, var(--ui-accent-soft));
  color: var(--selector-popover-trigger-open-color, var(--ui-accent-text));
}
.selector-popover__trigger:disabled {
  cursor: default;
  opacity: 0.55;
}
.selector-popover__icon {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  opacity: 0.75;
}
.selector-popover__icon :deep(svg) {
  width: 15px;
  height: 15px;
}
.selector-popover__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selector-popover__chevron {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  opacity: 0.55;
}
</style>
