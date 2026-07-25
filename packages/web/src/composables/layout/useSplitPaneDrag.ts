import { ref, watch, type Ref } from "vue";

interface SplitPaneDragOptions {
  panelRef: Ref<HTMLElement | null>;
  horizontal: boolean;
  direction: 1 | -1;
  cssVar: string;
  initialSize: number;
  minSize: number;
  maxSize: number;
  getMaxSize?: () => number;
  onCommit?: (size: number) => void;
}

type ClampedAxis = "min" | "max" | null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function useSplitPaneDrag(options: SplitPaneDragOptions) {
  const dragging = ref(false);
  const clamped = ref<ClampedAxis>(null);
  const minSize = Math.min(options.minSize, options.maxSize);
  const defaultMaxSize = Math.max(options.minSize, options.maxSize);
  const currentMaxSize = () => Math.max(minSize, options.getMaxSize?.() ?? defaultMaxSize);
  let size = clamp(options.initialSize, minSize, currentMaxSize());
  let startCoordinate = 0;
  let startSize = size;

  function applySize() {
    options.panelRef.value?.style.setProperty(options.cssVar, `${size}px`);
  }

  function recomputeClamped() {
    const maxSize = currentMaxSize();
    if (size <= minSize) clamped.value = "min";
    else if (size >= maxSize) clamped.value = "max";
    else clamped.value = null;
  }

  function setSize(nextSize: number) {
    size = clamp(nextSize, minSize, currentMaxSize());
    applySize();
    recomputeClamped();
  }

  watch(options.panelRef, applySize, { flush: "post" });
  recomputeClamped();

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragging.value = true;
    startCoordinate = options.horizontal ? event.clientX : event.clientY;
    startSize = size;
    recomputeClamped();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging.value) return;
    const coordinate = options.horizontal ? event.clientX : event.clientY;
    const previous = size;
    size = clamp(
      startSize + options.direction * (coordinate - startCoordinate),
      minSize,
      currentMaxSize(),
    );
    if (size !== previous) applySize();
    recomputeClamped();
  }

  function onPointerUp() {
    if (dragging.value) {
      options.onCommit?.(size);
    }
    dragging.value = false;
  }

  return { dragging, clamped, onPointerDown, onPointerMove, onPointerUp, setSize };
}
