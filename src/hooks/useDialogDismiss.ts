import { useCallback, useEffect, useRef, useState } from "react";

// Duration must match the dialog exit animation in styles.css
// (--motion-dialog: 150ms). Kept as a constant so the JS unmount delay and the
// CSS transition stay in lockstep.
const DIALOG_MOTION_MS = 150;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Plays an exit animation before invoking the real close handler.
 *
 * OpenChamber-style overlays fade + scale on the way out. Because these dialogs
 * are conditionally rendered by their parent (mount/unmount), we can't animate
 * on unmount directly. Instead `dismiss()` flips `closing` to true — which the
 * component uses to apply the `is-closing` class — and defers the parent's
 * `onClose` until the animation has finished.
 */
export function useDialogDismiss(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const dismiss = useCallback(() => {
    if (timerRef.current) return;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    setClosing(true);
    timerRef.current = setTimeout(() => {
      onCloseRef.current();
    }, DIALOG_MOTION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { closing, dismiss };
}
