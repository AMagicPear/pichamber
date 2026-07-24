import { ref, watch, type Ref } from "vue";

interface SplitPaneDragOptions {
  panelRef: Ref<HTMLElement | null>;
  horizontal: boolean;
  direction: 1 | -1;
  cssVar: string;
  initialSize: number;
  minSize: number;
  maxSize: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function useSplitPaneDrag(options: SplitPaneDragOptions) {
  const dragging = ref(false);
  const minSize = Math.min(options.minSize, options.maxSize);
  const maxSize = Math.max(options.minSize, options.maxSize);
  let size = clamp(options.initialSize, minSize, maxSize);
  let startCoordinate = 0;
  let startSize = size;

  function applySize() {
    options.panelRef.value?.style.setProperty(options.cssVar, `${size}px`);
  }

  watch(options.panelRef, applySize, { flush: "post" });

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragging.value = true;
    startCoordinate = options.horizontal ? event.clientX : event.clientY;
    startSize = size;
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging.value) return;
    const coordinate = options.horizontal ? event.clientX : event.clientY;
    size = clamp(startSize + options.direction * (coordinate - startCoordinate), minSize, maxSize);
    applySize();
  }

  function onPointerUp() {
    dragging.value = false;
  }

  return { dragging, onPointerDown, onPointerMove, onPointerUp };
}
