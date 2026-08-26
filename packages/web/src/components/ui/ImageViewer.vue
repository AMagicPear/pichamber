<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import CloseIcon from "lucide-static/icons/x.svg";
import MinusIcon from "lucide-static/icons/minus.svg";
import PlusIcon from "lucide-static/icons/plus.svg";
import ResetIcon from "lucide-static/icons/rotate-ccw.svg";
import IconButton from "./IconButton.vue";

const props = defineProps<{ show: boolean; src: string; alt: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

type Point = { x: number; y: number };
const stage = ref<HTMLElement | null>(null);
const scale = ref(1);
const offset = ref<Point>({ x: 0, y: 0 });
const dragging = ref(false);
const moved = ref(false);
const pointers = new Map<number, Point>();
let startScale = 1;
let startOffset: Point = { x: 0, y: 0 };
let startPoint: Point | null = null;
let startDistance = 0;
let startCenter: Point | null = null;
let clearMovedTimer: number | undefined;
const WHEEL_ZOOM_SENSITIVITY = 0.008;
const wheelZooms: Array<{ factor: number; anchor?: Point }> = [];
let wheelFrame = 0;

const resetView = () => {
  scale.value = 1;
  offset.value = { x: 0, y: 0 };
};
const setScale = (value: number, anchor?: Point) => {
  const previousScale = scale.value;
  scale.value = Math.min(4, Math.max(Number.EPSILON, Math.round(value * 10_000) / 10_000));
  if (anchor) {
    const ratio = scale.value / previousScale;
    offset.value = {
      x: anchor.x - (anchor.x - offset.value.x) * ratio,
      y: anchor.y - (anchor.y - offset.value.y) * ratio,
    };
  }
};
const zoom = (factor: number) => setScale(scale.value * factor);
const wheelDelta = (event: WheelEvent) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * (stage.value?.clientHeight ?? 800);
  return event.deltaY;
};
const flushWheelZooms = () => {
  wheelFrame = 0;
  for (const { factor, anchor } of wheelZooms.splice(0)) setScale(scale.value * factor, anchor);
};
const queueWheelZoom = (factor: number, anchor?: Point) => {
  wheelZooms.push({ factor, anchor });
  if (!wheelFrame) wheelFrame = requestAnimationFrame(flushWheelZooms);
};
const clearWheelZooms = () => {
  wheelZooms.length = 0;
  if (wheelFrame) cancelAnimationFrame(wheelFrame);
  wheelFrame = 0;
};
const center = (first: Point, second: Point) => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
const distance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.y - second.y);
const beginGesture = () => {
  const active = [...pointers.values()];
  startScale = scale.value;
  startOffset = offset.value;
  startPoint = active.length === 1 ? active[0]! : null;
  startDistance = active.length > 1 ? distance(active[0]!, active[1]!) : 0;
  startCenter = active.length > 1 ? center(active[0]!, active[1]!) : null;
};
const onPointerDown = (event: PointerEvent) => {
  if (clearMovedTimer) window.clearTimeout(clearMovedTimer);
  if (pointers.size === 0) moved.value = false;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  dragging.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  beginGesture();
};
const onPointerMove = (event: PointerEvent) => {
  if (!pointers.has(event.pointerId)) return;
  moved.value = true;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const active = [...pointers.values()];
  if (active.length > 1 && startDistance && startCenter) {
    setScale(startScale * (distance(active[0]!, active[1]!) / startDistance));
    const nextCenter = center(active[0]!, active[1]!);
    offset.value = {
      x: startOffset.x + nextCenter.x - startCenter.x,
      y: startOffset.y + nextCenter.y - startCenter.y,
    };
  } else if (active.length === 1 && startPoint) {
    offset.value = {
      x: startOffset.x + active[0]!.x - startPoint.x,
      y: startOffset.y + active[0]!.y - startPoint.y,
    };
  }
};
const onPointerEnd = (event: PointerEvent) => {
  pointers.delete(event.pointerId);
  dragging.value = pointers.size > 0;
  beginGesture();
  if (pointers.size === 0 && moved.value) {
    clearMovedTimer = window.setTimeout(() => { moved.value = false; }, 0);
  }
};
const onWheel = (event: WheelEvent) => {
  const delta = wheelDelta(event);
  // Chromium reports a trackpad pinch as Ctrl + wheel with pixel-level delta.
  // All pointing devices follow this same canvas interaction model.
  if (event.ctrlKey) {
    event.preventDefault();
    const bounds = stage.value?.getBoundingClientRect();
    const anchor = bounds
      ? { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 }
      : undefined;
    queueWheelZoom(Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), anchor);
  } else {
    event.preventDefault();
    offset.value = { x: offset.value.x - event.deltaX, y: offset.value.y - event.deltaY };
  }
};
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") emit("close");
  else if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoom(1.15);
  } else if (event.key === "-") {
    event.preventDefault();
    zoom(1 / 1.15);
  } else if (event.key === "0") {
    event.preventDefault();
    resetView();
  }
};
const onStageClick = (event: MouseEvent) => {
  if (event.target !== event.currentTarget) return;
  if (moved.value) {
    moved.value = false;
    return;
  }
  emit("close");
};

watch(() => props.show, (isOpen) => {
  clearWheelZooms();
  pointers.clear();
  if (clearMovedTimer) window.clearTimeout(clearMovedTimer);
  clearMovedTimer = undefined;
  dragging.value = false;
  moved.value = false;
  resetView();
  if (isOpen) document.addEventListener("keydown", onKeyDown);
  else document.removeEventListener("keydown", onKeyDown);
});
onBeforeUnmount(() => {
  clearWheelZooms();
  if (clearMovedTimer) window.clearTimeout(clearMovedTimer);
  document.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="image-viewer">
      <div v-if="show" class="image-viewer" role="dialog" aria-modal="true" :aria-label="alt">
        <div ref="stage" class="image-viewer__stage" @click="onStageClick">
          <img
            :src="src"
            :alt="alt"
            :class="{ 'is-dragging': dragging }"
            :style="{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }"
            draggable="false"
            @dragstart.prevent
            @wheel="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerEnd"
            @pointercancel="onPointerEnd"
          />
        </div>
        <div class="image-viewer__controls" @click.stop @pointerdown.stop>
          <IconButton size="compact" :label="t('imagePreview.zoomOut')" @click="zoom(1 / 1.15)"><MinusIcon /></IconButton>
          <IconButton size="compact" :label="t('imagePreview.reset')" :disabled="scale === 1 && offset.x === 0 && offset.y === 0" @click="resetView"><ResetIcon /></IconButton>
          <IconButton size="compact" :label="t('imagePreview.zoomIn')" :disabled="scale === 4" @click="zoom(1.15)"><PlusIcon /></IconButton>
          <IconButton size="compact" :label="t('common.close')" @click="emit('close')"><CloseIcon /></IconButton>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.image-viewer {
  position: fixed;
  z-index: 1200;
  inset: 0;
  background: rgb(20 19 17 / 32%);
  transition: opacity 150ms ease;
}
.image-viewer__stage {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
}
.image-viewer__stage img {
  display: block;
  max-width: calc(100vw - 64px);
  max-height: calc(100vh - 64px);
  cursor: grab;
  user-select: none;
  -webkit-user-drag: none;
  will-change: transform;
}
.image-viewer__stage img.is-dragging { cursor: grabbing; }
.image-viewer__controls {
  position: absolute;
  bottom: 20px;
  left: 50%;
  display: flex;
  gap: 4px;
  padding: 2px;
  transform: translateX(-50%);
  border: 1px solid rgb(255 255 255 / 24%);
  border-radius: 8px;
  background: rgb(20 19 17 / 82%);
  color: white;
  backdrop-filter: blur(8px);
}
.image-viewer__controls :deep(.icon-button:hover:not(:disabled)),
.image-viewer__controls :deep(.icon-button:focus-visible) { background: rgb(255 255 255 / 16%); }
.image-viewer-enter-from,
.image-viewer-leave-to { opacity: 0; }
</style>
