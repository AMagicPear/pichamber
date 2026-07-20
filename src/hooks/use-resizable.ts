import { useCallback, useEffect, useRef, useState } from "react";

interface UseResizableOptions {
  /** Minimum width in px */
  min: number;
  /** Maximum width in px */
  max: number;
  /** Initial width */
  initial: number;
  /** Called while dragging with the new width */
  onResize(width: number): void;
  /** Which edge of the panel is being dragged */
  edge: "left" | "right";
}

/**
 * OpenChamber-style panel resize hook. Returns refs to attach to the handle
 * element and a dragging flag for styling.
 *
 * Resize callbacks are throttled to once per frame (rAF) so the React tree
 * only re-renders at most 60 fps during a drag, regardless of mouse event
 * frequency.
 */
export function useResizable({ min, max, initial, onResize, edge }: UseResizableOptions) {
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(initial);
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

  const handleRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(true);

      const startX = event.clientX;
      const startWidth = widthRef.current;
      let raf = 0;

      const onMouseMove = (e: MouseEvent) => {
        const delta = edge === "right" ? e.clientX - startX : startX - e.clientX;
        const next = Math.min(max, Math.max(min, startWidth + delta));
        widthRef.current = next;
        // Throttle state updates to once per animation frame.
        if (!raf) {
          raf = requestAnimationFrame(() => {
            raf = 0;
            onResizeRef.current(widthRef.current);
          });
        }
      };

      const onMouseUp = () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        // Push the final width synchronously so the persisted value is exact.
        onResizeRef.current(widthRef.current);
        setDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [edge, min, max],
  );

  return { handleRef, dragging, onMouseDown };
}
