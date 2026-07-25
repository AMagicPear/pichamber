<script setup lang="ts">
import { computed, useTemplateRef, watch } from "vue";
import { useUiStore, type SplitMode } from "@/stores/ui";
import { useSplitPaneDrag } from "@/composables/layout/useSplitPaneDrag";

defineOptions({ name: "SplitPane" });

const props = withDefaults(
  defineProps<{
    mode?: SplitMode;
    minSize?: number;
    maxSize?: number;
  }>(),
  {
    mode: "left",
    minSize: 160,
    maxSize: 600,
  },
);
const ui = useUiStore();
const isOpen = computed(() => ui.panels[props.mode].open);
const initialSize = computed(() => ui.panels[props.mode].size);
const isMaximized = computed(() => props.mode === "bottom" && ui.maximized[props.mode]);
const isLeftish = props.mode === "left" || props.mode === "settings";
const direction = isLeftish ? 1 : -1;
const cssVar = props.mode === "bottom" ? "--split-h" : "--split-w";
const horizontal = props.mode !== "bottom";

// Cursor used when the resize handle is dragged into a clamp boundary.
// `direction` tells us which screen direction GROWS the panel:
//   left / settings panels: +1 → right grows
//   right panel:            -1 → left grows
//   bottom panel:           -1 → up grows
// At the min boundary only the grow direction can still do work; at the max
// boundary only the shrink direction can. Matches native widgets like VSCode.
const CLAMPED_CURSOR = {
  h: {
    "-1": { min: "w-resize", max: "e-resize" },
    "1": { min: "e-resize", max: "w-resize" },
  },
  v: {
    "-1": { min: "n-resize", max: "s-resize" },
    "1": { min: "s-resize", max: "n-resize" },
  },
} as const;

const panelRef = useTemplateRef<HTMLElement>("panelRef");
const dragMaxSize = props.maxSize;
const getDragMaxSize =
  props.mode === "bottom"
    ? () =>
        Math.max(dragMaxSize, panelRef.value?.parentElement?.getBoundingClientRect().height ?? 0)
    : undefined;
const { dragging, clamped, onPointerDown, onPointerMove, onPointerUp, setSize } = useSplitPaneDrag({
  panelRef,
  horizontal,
  direction,
  cssVar,
  initialSize: initialSize.value,
  minSize: props.minSize,
  maxSize: dragMaxSize,
  getMaxSize: getDragMaxSize,
  onCommit: (size) => ui.setSize(props.mode, size),
});

function onSplitPointerDown(event: PointerEvent): void {
  if (props.mode === "bottom" && isMaximized.value && panelRef.value) {
    setSize(panelRef.value.getBoundingClientRect().height);
    ui.setMaximized(props.mode, false);
  }
  onPointerDown(event);
}

watch(isOpen, (open) => {
  if (!open) ui.setMaximized(props.mode, false);
});

const handleStyle = computed(() => {
  if (!dragging.value || clamped.value === null) return undefined;
  const axis = horizontal ? "h" : "v";
  const sign = direction === 1 ? "1" : "-1";
  return { cursor: CLAMPED_CURSOR[axis][sign][clamped.value] };
});
</script>

<template>
  <div class="split-pane" :class="`split-pane--${mode}`">
    <main class="split-pane__main"><slot /></main>
    <div
      class="split-pane__handle"
      :class="{ 'is-open': isOpen, 'is-dragging': dragging }"
      :style="handleStyle"
      role="separator"
      :aria-orientation="horizontal ? 'vertical' : 'horizontal'"
      @pointerdown="onSplitPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <span class="split-pane__line" />
    </div>
    <section
      ref="panelRef"
      class="split-pane__panel"
      :class="{ 'is-open': isOpen, 'is-dragging': dragging, 'is-maximized': isMaximized }"
    >
      <div class="split-pane__content">
        <slot name="sidebar">边栏</slot>
      </div>
    </section>
  </div>
</template>

<style scoped>
.split-pane {
  display: flex;
  flex: 1 1 0;
  align-self: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.split-pane--left > .split-pane__main,
.split-pane--settings > .split-pane__main {
  order: 2;
}
.split-pane--left > .split-pane__handle,
.split-pane--settings > .split-pane__handle {
  order: 1;
}
.split-pane--left > .split-pane__panel,
.split-pane--settings > .split-pane__panel {
  order: 0;
}
.split-pane--right > .split-pane__handle {
  order: 1;
}
.split-pane--right > .split-pane__panel {
  order: 2;
}
.split-pane--bottom {
  flex-direction: column;
}

.split-pane__main {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.split-pane__panel {
  display: flex;
  align-self: stretch;
  flex: 0 0 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  transition:
    flex-basis 180ms ease,
    width 180ms ease,
    height 180ms ease;
}
.split-pane__content {
  flex: 0 0 var(--split-w, 280px);
  width: var(--split-w, 280px);
  height: 100%;
  min-width: var(--split-w, 280px);
  overflow: hidden;
}
.split-pane--left > .split-pane__panel,
.split-pane--settings > .split-pane__panel,
.split-pane--right > .split-pane__panel {
  width: 0;
}
.split-pane--left > .split-pane__panel.is-open,
.split-pane--settings > .split-pane__panel.is-open,
.split-pane--right > .split-pane__panel.is-open {
  width: var(--split-w, 280px);
  flex-basis: var(--split-w, 280px);
}
.split-pane--bottom > .split-pane__panel {
  height: 0;
}
.split-pane--bottom > .split-pane__panel > .split-pane__content {
  flex: 1 1 auto;
  width: 100%;
  height: var(--split-h, 280px);
  min-width: 0;
  min-height: var(--split-h, 280px);
  overflow: hidden;
}
.split-pane--bottom > .split-pane__panel.is-open {
  height: var(--split-h, 280px);
  flex-basis: var(--split-h, 280px);
}

.split-pane--bottom > .split-pane__panel.is-maximized {
  height: calc(100% - 9px);
  flex-basis: calc(100% - 9px);
}
.split-pane--bottom > .split-pane__panel.is-maximized > .split-pane__content {
  height: 100%;
  min-height: 0;
}

.split-pane__handle {
  position: relative;
  flex: 0 0 0;
  width: 0;
  overflow: hidden;
  pointer-events: none;
  touch-action: none;
  transition:
    flex-basis 180ms ease,
    width 180ms ease;
}
.split-pane__handle.is-open {
  flex-basis: 9px;
  width: 9px;
  pointer-events: auto;
}
.split-pane__line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 1px;
  background: #e8e6df;
  transition:
    left 120ms ease,
    width 120ms ease,
    background-color 120ms ease;
}
.split-pane--left > .split-pane__handle,
.split-pane--settings > .split-pane__handle,
.split-pane--right > .split-pane__handle {
  cursor: col-resize;
}
.split-pane--bottom > .split-pane__handle {
  width: 100%;
  height: 0;
  cursor: row-resize;
}
.split-pane--bottom > .split-pane__handle.is-open {
  flex-basis: 9px;
  height: 9px;
  width: 100%;
}
.split-pane--bottom > .split-pane__handle > .split-pane__line {
  top: 4px;
  right: 0;
  bottom: auto;
  left: 0;
  width: auto;
  height: 1px;
}
.split-pane__handle.is-dragging .split-pane__line,
.split-pane__handle:hover .split-pane__line {
  background: rgba(0, 0, 0, 0.25);
  left: 3px;
  width: 3px;
}
.split-pane--bottom > .split-pane__handle:hover > .split-pane__line,
.split-pane--bottom > .split-pane__handle.is-dragging > .split-pane__line {
  top: 3px;
  right: 0;
  left: 0;
  width: auto;
  height: 3px;
}
.split-pane__panel.is-dragging,
.split-pane__handle.is-dragging {
  transition: none;
}
</style>
