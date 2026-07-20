import { useEffect, useRef } from "react";
import morphdom from "morphdom";
import {
  renderMarkdownBlocks,
  renderMarkdownSync,
  type RenderedBlock,
} from "../vendor/openchamber/components/chat/markdown/markdownCore";

// ── Markdown renderer (vendored OpenChamber pipeline) ───────────────────────
//
// Pichamber now renders assistant and user messages through OpenChamber's
// markdown pipeline (vendored under src/vendor/openchamber/). That brings:
//   - Shiki syntax highlighting via a dedicated Web Worker
//   - KaTeX math (block $$...$$ + inline \(...\))
//   - Per-block morphdom reconciliation (only the trailing streaming block
//     re-parses per step; leading blocks stay stable)
//   - DOMPurify sanitization with Shiki/KaTeX/SVG allowlists
//   - remend-based healing of incomplete links/syntax mid-stream
// The previous marked + highlight.js + manual decorate() pass is removed in
// favour of this; the public component contract ({ children, onOpenPath })
// stays unchanged so Message.tsx and Composer previews keep working.

interface MarkdownProps {
  children: string;
  /** Called when the user clicks on a path-looking token inside a code block. */
  onOpenPath?: (path: string) => void;
}

export function Markdown({ children, onOpenPath }: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<RenderedBlock[]>([]);
  const streamingRef = useRef(false);

  // The renderer only fires async (Shiki worker) when content is non-empty. We
  // gate streaming behavior on whether the latest message is still being
  // written; Pichamber currently treats every render as settled, so streaming
  // is off until we wire the per-message `streaming` flag through.
  streamingRef.current = false;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>("[data-markdown-content]") ?? container;
    if (!target) return;

    // Synchronous first paint: render the full markdown with escape-only code
    // (no Shiki colors) so there is no blank frame while the worker resolves.
    // Subsequent morphdom upgrades only the trailing block(s).
    if (children && target.childNodes.length === 0) {
      const block = document.createElement("div");
      block.setAttribute("data-md-block", "");
      block.style.display = "contents";
      block.innerHTML = renderMarkdownSync(children);
      target.appendChild(block);
    }
  }, [children]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>("[data-markdown-content]") ?? container;
    if (!target) return;
    if (!children) {
      target.innerHTML = "";
      blocksRef.current = [];
      return;
    }

    let active = true;
    void renderMarkdownBlocks(children, streamingRef.current, `markdown-${children.length}`).then((blocks) => {
      if (!active) return;
      blocksRef.current = blocks;

      const existing = Array.from(target.children) as HTMLElement[];
      blocks.forEach((block, index) => {
        let el = existing[index];
        if (!el) {
          el = document.createElement("div");
          el.setAttribute("data-md-block", "");
          el.style.display = "contents";
          target.appendChild(el);
        }
        if (el.getAttribute("data-md-id") === block.id) return;

        const temp = document.createElement("div");
        temp.innerHTML = block.html;
        morphdom(el, temp, {
          childrenOnly: true,
          onBeforeElUpdated: (fromEl, toEl) => !fromEl.isEqualNode(toEl),
        });
        el.setAttribute("data-md-id", block.id);
      });

      // Drop trailing blocks the new content no longer needs.
      for (let i = existing.length - 1; i >= blocks.length; i -= 1) {
        existing[i]?.remove();
      }
    });

    return () => {
      active = false;
    };
  }, [children]);

  // Click delegation for path tokens inside code blocks. OpenChamber's
  // annotateFileLinks pipeline injects `data-md-block-path` spans; we surface
  // them via the same `onOpenPath` callback Pichamber already exposes.
  useEffect(() => {
    if (!onOpenPath) return;
    const container = containerRef.current;
    if (!container) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const token = target?.closest<HTMLElement>("[data-md-block-path]");
      if (!token) return;
      const raw = token.getAttribute("data-md-block-path");
      if (!raw) return;
      event.preventDefault();
      onOpenPath(raw);
    };
    container.addEventListener("click", handler);
    return () => container.removeEventListener("click", handler);
  }, [onOpenPath]);

  // Render an empty container; the effect above populates the body once
  // mounted. `suppressHydrationWarning` is unnecessary here (no SSR).
  return (
    <div ref={containerRef} className="markdown-body markdown-content leading-relaxed" data-markdown-content />
  );
}