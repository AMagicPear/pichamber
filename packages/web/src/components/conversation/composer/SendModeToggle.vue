<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";

type SendMode = "steer" | "followUp";
type TabBounds = { steer: DOMRect; followUp: DOMRect };

const props = defineProps<{
  modelValue: SendMode;
  steerLabel: string;
  followUpLabel: string;
  ariaLabel: string;
}>();

const emit = defineEmits<{ "update:modelValue": [mode: SendMode] }>();

const steerButton = useTemplateRef<HTMLButtonElement>("steerButton");
const followUpButton = useTemplateRef<HTMLButtonElement>("followUpButton");
const indicatorStyle = ref<Record<string, string>>({});
const isDragging = ref(false);
let bounds: TabBounds | null = null;
let resizeObserver: ResizeObserver | null = null;
let drag: { pointerId: number; startX: number; mode: SendMode; active: boolean } | null = null;
let suppressClick = false;
const DRAG_THRESHOLD = 3;

const updateBounds = () => {
  const steer = steerButton.value;
  const followUp = followUpButton.value;
  const host = steer?.parentElement;
  if (!steer || !followUp || !host) {
    bounds = null;
    return;
  }
  bounds = { steer: steer.getBoundingClientRect(), followUp: followUp.getBoundingClientRect() };
};

const syncIndicator = () => {
  updateBounds();
  const rect = bounds?.[props.modelValue];
  if (!rect) return;
  const host = steerButton.value?.parentElement;
  if (!host) return;
  const hostLeft = host.getBoundingClientRect().left;
  indicatorStyle.value = {
    "--mode-indicator-x": `${rect.left - hostLeft}px`,
    "--mode-indicator-w": `${rect.width}px`,
  };
};

const onClick = (mode: SendMode) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  emit("update:modelValue", mode);
};

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || !bounds) return;
  drag = { pointerId: event.pointerId, startX: event.clientX, mode: props.modelValue, active: false };
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
};

const onPointerMove = (event: PointerEvent) => {
  if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
  const deltaX = event.clientX - drag.startX;
  if (!drag.active) {
    if (Math.abs(deltaX) <= DRAG_THRESHOLD) return;
    drag.active = true;
    isDragging.value = true;
  }
  const start = bounds[drag.mode];
  const end = bounds[drag.mode === "steer" ? "followUp" : "steer"];
  const host = steerButton.value?.parentElement;
  if (!host) return;
  const hostLeft = host.getBoundingClientRect().left;
  const minCenter = bounds.steer.left + bounds.steer.width / 2;
  const maxCenter = bounds.followUp.left + bounds.followUp.width / 2;
  const center = Math.max(minCenter, Math.min(maxCenter, start.left + start.width / 2 + deltaX));
  const progress = (center - (start.left + start.width / 2)) /
    (end.left + end.width / 2 - start.left - start.width / 2 || 1);
  const width = start.width + (end.width - start.width) * progress;
  indicatorStyle.value = {
    "--mode-indicator-x": `${center - width / 2 - hostLeft}px`,
    "--mode-indicator-w": `${width}px`,
  };
};

const onPointerEnd = (event: PointerEvent) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const session = drag;
  drag = null;
  isDragging.value = false;
  (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  if (!session.active) return;

  updateBounds();
  if (!bounds) return;
  suppressClick = true;
  const middle = (bounds.steer.left + bounds.steer.width / 2 + bounds.followUp.left + bounds.followUp.width / 2) / 2;
  const mode: SendMode = event.clientX < middle ? "steer" : "followUp";
  emit("update:modelValue", mode);
  nextTick(syncIndicator);
};

const onPointerCancel = (event: PointerEvent) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag = null;
  isDragging.value = false;
  (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
};

onMounted(() => {
  syncIndicator();
  resizeObserver = new ResizeObserver(() => {
    updateBounds();
    if (!drag?.active) syncIndicator();
  });
  if (steerButton.value) resizeObserver.observe(steerButton.value);
  if (followUpButton.value) resizeObserver.observe(followUpButton.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());
watch(() => props.modelValue, () => nextTick(syncIndicator));
</script>

<template>
  <div class="send-mode-toggle" role="tablist" :aria-label="ariaLabel" :data-dragging="isDragging">
    <button ref="steerButton" type="button" role="tab" :aria-selected="modelValue === 'steer'"
      :class="{ 'is-active': modelValue === 'steer' }" @click="onClick('steer')"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerEnd" @pointercancel="onPointerCancel">
      {{ steerLabel }}
    </button>
    <button ref="followUpButton" type="button" role="tab" :aria-selected="modelValue === 'followUp'"
      :class="{ 'is-active': modelValue === 'followUp' }" @click="onClick('followUp')"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerEnd" @pointercancel="onPointerCancel">
      {{ followUpLabel }}
    </button>
    <span class="send-mode-toggle__indicator" aria-hidden="true" :style="indicatorStyle" />
  </div>
</template>

<style scoped>
.send-mode-toggle {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: 24px;
  padding: 2px;
  border-radius: 7px;
  background: var(--ui-surface-selected);
  margin-left: 2px;
}

.send-mode-toggle button {
  position: relative;
  z-index: 1;
  height: 20px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color 180ms var(--ui-ease-emphasized);
}

.send-mode-toggle button.is-active { color: var(--ui-text-strong); }

.send-mode-toggle__indicator {
  position: absolute;
  top: 2px;
  left: 0;
  z-index: 0;
  width: var(--mode-indicator-w, 0);
  height: 20px;
  border-radius: 5px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-control);
  transform: translateX(var(--mode-indicator-x, 0));
  transition: transform 220ms var(--ui-ease-emphasized), width 220ms var(--ui-ease-emphasized);
  pointer-events: none;
  will-change: transform, width;
}

.send-mode-toggle[data-dragging="true"] { cursor: grabbing; user-select: none; -webkit-user-select: none; }
.send-mode-toggle[data-dragging="true"] button { cursor: grabbing; }
.send-mode-toggle[data-dragging="true"] .send-mode-toggle__indicator { transition: none; }

@media (prefers-reduced-motion: reduce) {
  .send-mode-toggle__indicator,
  .send-mode-toggle button { transition: none; }
}
</style>
