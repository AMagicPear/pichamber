import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// OpenChamber-style pinned shadow values — sonner rewrites inline styles on
// focus/hover, so we keep applying them via a MutationObserver that targets
// the actual toast DOM nodes.
const SHADOW_LIGHT =
  "inset 0 1px 0 0 rgba(255,255,255,0.8), inset 0 0 0 1px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.10), 0 1px 2px -0.5px rgba(0,0,0,0.08), 0 4px 8px -2px rgba(0,0,0,0.08), 0 12px 20px -4px rgba(0,0,0,0.08)";
const SHADOW_DARK =
  "inset 0 1px 0 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 0 1px rgba(0,0,0,0.36), 0 1px 1px -0.5px rgba(0,0,0,0.22), 0 3px 3px -1.5px rgba(0,0,0,0.20), 0 6px 6px -3px rgba(0,0,0,0.16)";

function useIsDarkTheme(): boolean {
  const get = () => typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [isDark, setIsDark] = useState(get);
  useEffect(() => {
    const update = () => setIsDark(get());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => observer.disconnect();
  }, []);
  return isDark;
}

/**
 * Sonner makes every toast focusable (tabIndex=0) and pins a `:focus-visible`
 * shadow that erases our elevation styling. We force-pinned inline styles so
 * the toast keeps the same depth regardless of interaction.
 */
function usePinnedToastStyles(shadow: string) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const apply = (el: HTMLElement) => {
      el.style.setProperty("box-shadow", shadow, "important");
      el.style.setProperty("outline", "none", "important");
      if (el.getAttribute("tabindex") === "0") el.setAttribute("tabindex", "-1");
    };
    const applyToAll = () => {
      document.querySelectorAll<HTMLElement>("[data-sonner-toast]").forEach(apply);
    };
    applyToAll();
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.("[data-sonner-toast]")) apply(node);
          node.querySelectorAll?.<HTMLElement>("[data-sonner-toast]").forEach(apply);
        });
      }
      applyToAll();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "tabindex", "data-expanded", "data-swiping"],
    });
    return () => observer.disconnect();
  }, [shadow]);
}

export function Toaster(props: ToasterProps) {
  const isDark = useIsDarkTheme();
  const shadow = isDark ? SHADOW_DARK : SHADOW_LIGHT;
  usePinnedToastStyles(shadow);
  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      position="bottom-right"
      closeButton={false}
      toastOptions={{
        classNames: {
          toast: "!rounded-[10px] !border-0 !px-3.5 !py-3 !gap-2.5",
          title: "!font-medium",
          description: "!mt-0.5",
        },
        style: {
          borderRadius: "10px",
          backgroundColor: "var(--surface-raised)",
          color: "var(--foreground)",
        },
      }}
      style={{
        ["--normal-bg" as string]: "var(--surface-raised)",
        ["--normal-text" as string]: "var(--foreground)",
        ["--normal-border" as string]: "transparent",
        ["--error-bg" as string]: "var(--surface-raised)",
        ["--error-text" as string]: "var(--foreground)",
        ["--error-border" as string]: "transparent",
        ["--success-bg" as string]: "var(--surface-raised)",
        ["--success-text" as string]: "var(--foreground)",
        ["--success-border" as string]: "transparent",
        ["--warning-bg" as string]: "var(--surface-raised)",
        ["--warning-text" as string]: "var(--foreground)",
        ["--warning-border" as string]: "transparent",
        ["--info-bg" as string]: "var(--surface-raised)",
        ["--info-text" as string]: "var(--foreground)",
        ["--info-border" as string]: "transparent",
      }}
      {...props}
    />
  );
}
