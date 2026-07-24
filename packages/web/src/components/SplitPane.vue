<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { useUiStore, type SplitMode } from "@/stores/ui";
import { useSplitPaneDrag } from "@/composables/useSplitPaneDrag";

defineOptions({ name: "SplitPane" });

const props = withDefaults(
  defineProps<{
    mode?: SplitMode;
    initialSize?: number;
    minSize?: number;
    maxSize?: number;
  }>(),
  {
    mode: "left",
    initialSize: 280,
    minSize: 160,
    maxSize: 600,
  },
);
const ui = useUiStore();
const isOpen = computed(() => ui.panels[props.mode].open);
const direction = props.mode === "left" ? 1 : -1;
const cssVar = props.mode === "bottom" ? "--split-h" : "--split-w";
const horizontal = props.mode !== "bottom";

const panelRef = useTemplateRef<HTMLElement>("panelRef");
const { dragging, onPointerDown, onPointerMove, onPointerUp } = useSplitPaneDrag({
  panelRef,
  horizontal,
  direction,
  cssVar,
  initialSize: props.initialSize,
  minSize: props.minSize,
  maxSize: props.maxSize,
});
</script>

<template>
  <div class="split-pane" :class="`split-pane--${mode}`">
    <main class="split-pane__main"><slot /></main>
    <div
      class="split-pane__handle"
      :class="{ 'is-open': isOpen, 'is-dragging': dragging }"
      role="separator"
      :aria-orientation="horizontal ? 'vertical' : 'horizontal'"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <span class="split-pane__line" />
    </div>
    <section
      ref="panelRef"
      class="split-pane__panel"
      :class="{ 'is-open': isOpen, 'is-dragging': dragging }"
    >
      <slot name="sidebar"> 边栏 </slot>
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
.split-pane--left > .split-pane__main {
  order: 2;
}
.split-pane--left > .split-pane__handle {
  order: 1;
}
.split-pane--left > .split-pane__panel {
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
  display: grid;
  place-items: center;
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
.split-pane--left > .split-pane__panel,
.split-pane--right > .split-pane__panel {
  width: 0;
}
.split-pane--left > .split-pane__panel.is-open,
.split-pane--right > .split-pane__panel.is-open {
  width: var(--split-w, 280px);
  flex-basis: var(--split-w, 280px);
}
.split-pane--bottom > .split-pane__panel {
  height: 0;
}
.split-pane--bottom > .split-pane__panel.is-open {
  height: var(--split-h, 280px);
  flex-basis: var(--split-h, 280px);
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
  background: #bdbdbd;
  transition:
    left 120ms ease,
    width 120ms ease,
    background-color 120ms ease;
}
.split-pane--left > .split-pane__handle,
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
  background: rgba(96, 96, 96, 0.55);
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
