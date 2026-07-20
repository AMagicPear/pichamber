import { useCallback, useEffect, useRef, useState } from "react";

interface UseResizableOptions {
  /** Minimum width in px */
  min: number;
  /** Maximum width in px */
  max: number;
  /** Initial width */
  initial: number;
  /** Called ONLY on drag-end with the final width (for persistence). */
  onResize(width: number): void;
  /** Which edge of the panel is being dragged */
  edge: "left" | "right";
  /** CSS custom property name to set on the panel element (e.g. "--sidebar-w") */
  cssVar: string;
}

/**
 * Zero-React-overhead panel resize hook.
 *
 * While dragging, the hook writes the new width directly to a CSS custom
 * property on the panel DOM element — no React state updates, no
 * reconciliation.  Only on mouse-up does it call `onResize` to persist the
 * final width.  This gives butter-smooth 60 fps dragging that feels
 * identical to native browser layout.
 */
export function useResizable({ min, max, initial, onResize, edge, cssVar }: UseResizableOptions) {
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(initial);
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);

  /** Ref for the resize handle (the draggable edge). */
  const handleRef = useRef<HTMLDivElement>(null);
  /** Ref for the panel itself — CSS custom property is written here. */
  const panelRef = useRef<HTMLElement>(null);

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(true);

      const startX = event.clientX;
      const startWidth = widthRef.current;
      const panel = panelRef.current;

      const onMouseMove = (e: MouseEvent) => {
        const delta = edge === "right" ? e.clientX - startX : startX - e.clientX;
        const next = Math.min(max, Math.max(min, startWidth + delta));
        widthRef.current = next;
        // Direct DOM write — no React involved. The CSS transition is
        // suppressed by the `.no-transition` class during drag, so the
        // panel follows the cursor pixel-for-pixel.
        if (panel) {
          panel.style.setProperty(cssVar, `${next}px`);
        }
      };

      const onMouseUp = () => {
        // Commit the final width to React state so it's persisted.
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
    [edge, min, max, cssVar],
  );

  return { handleRef, panelRef, dragging, onMouseDown };
}
