/**
 * Shared popover logic for teleported panels (model selector, thinking
 * selector, …).
 *
 * Owns the open state, the fixed-position math (flip above the trigger,
 * clamp to the viewport), and the global listeners that close the panel:
 * outside pointerdown, Escape, resize, and scroll.
 */
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";

type Size = number | (() => number);

type PopoverOptions = {
  /** Element containing the trigger button; used for outside-click containment. */
  root: Ref<HTMLElement | null>;
  /** CSS selector for the trigger inside `root`. */
  trigger: string;
  /** Class on the teleported panel; used for outside-click containment. */
  panel: string;
  /** Panel size for flip/clamp math. The panel's own CSS controls its
   *  rendered size — these values are never written to the style. */
  width?: Size;
  height?: Size;
  /** Gap between trigger and panel. */
  gap?: number;
  /** Called after the panel is positioned on open. */
  onOpen?: () => void;
};

const resolveSize = (size: Size | undefined): number =>
  typeof size === "function" ? size() : (size ?? 0);

export const usePopover = ({
  root,
  trigger,
  panel,
  width,
  height,
  gap = 6,
  onOpen,
}: PopoverOptions) => {
  const open = ref(false);
  /** Fixed-position style for the teleported panel. */
  const style = ref<Record<string, string>>({});

  const updatePosition = () => {
    const anchor = root.value?.querySelector<HTMLElement>(trigger);
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panelWidth = resolveSize(width);
    const panelHeight = resolveSize(height);
    // Prefer opening upward; flip below the trigger when there isn't enough
    // headroom. Clamp to the viewport with an 8px margin.
    const top = rect.top - panelHeight - gap >= 8 ? rect.top - panelHeight - gap : rect.bottom + gap;
    style.value = {
      position: "fixed",
      top: `${Math.max(8, top)}px`,
      left: `${Math.max(8, Math.min(window.innerWidth - panelWidth - 8, rect.right - panelWidth))}px`,
    };
  };

  const close = () => {
    open.value = false;
  };
  const toggle = () => {
    open.value = !open.value;
  };

  const onDocPointerDown = (event: PointerEvent) => {
    if (!open.value) return;
    const target = event.target as Node;
    if (root.value?.contains(target)) return;
    if (target instanceof Element && target.closest(panel)) return;
    close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  watch(open, async (next) => {
    if (next) {
      document.addEventListener("pointerdown", onDocPointerDown);
      document.addEventListener("keydown", onKeyDown);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      await nextTick();
      updatePosition();
      onOpen?.();
    } else {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    }
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", updatePosition);
    window.removeEventListener("scroll", updatePosition, true);
  });

  return { open, style, close, toggle };
};
