import { useRef, useEffect } from "react";
import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import morphdom from "morphdom";

// ── marked config (GFM + syntax highlighting) ──────────────────────

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      const language = hljs.getLanguage(lang ?? "") ? lang : undefined;
      const highlighted = language
        ? hljs.highlight(text, { language }).value
        : text;
      const langAttr = language ? ` class="language-${language}"` : "";
      return `<pre><code${langAttr}>${highlighted}</code></pre>`;
    },
  },
});

// ── File reference detection ────────────────────────────────────────
// Mirrors OpenChamber's BLOCK_PATH_TOKEN_RE: matches `path[:line[:col]]` or
// `path:start-end` (range) for paths that contain a file extension. Used to
// annotate file mentions inside fenced code blocks with `data-md-block-path`.

const BLOCK_PATH_TOKEN_RE = /(?:[A-Za-z]:[\\/])?[\w.\-/@+]*[\w\-/@+]\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?(?::\d+)?)?/g;

const KNOWN_FILE_BASENAMES = new Set([
  "dockerfile", "makefile", "readme", "license",
  ".env", ".gitignore", ".npmrc",
]);

function isLikelyFilePath(value: string): boolean {
  if (!value || value.startsWith("--") || value.includes("://")) return false;
  if (/[<>]/.test(value) || /\s{2,}/.test(value)) return false;
  const base = (value.split(/[\\/]/).filter(Boolean).pop() ?? "").toLowerCase();
  if (!base || base === "." || base === "..") return false;
  if (KNOWN_FILE_BASENAMES.has(base) || (base.startsWith(".") && base.length > 1)) return true;
  return /\.[A-Za-z0-9_-]{1,16}$/.test(base);
}

// ── DOMPurify ──────────────────────────────────────────────────────

const purify = (html: string): string => {
  if (typeof window === "undefined") return html;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "ul", "ol", "li",
      "blockquote", "pre", "code",
      "table", "thead", "tbody", "tr", "th", "td",
      "strong", "em", "del", "s",
      "a", "img",
      "input", "label",
      "span", "div",
      "details", "summary",
    ],
    ALLOWED_ATTR: [
      "href", "target", "rel", "title",
      "src", "alt",
      "class", "id",
      "type", "checked", "disabled",
      "data-language", "data-md-block-path",
    ],
  }) as string;
};

// ── Post-process HTML: wrap tables + code blocks ────────────────────

function decorateHtml(html: string): string {
  if (!html) return html;

  // Wrap <table> in scrollable container
  html = html.replace(/<table>/g, '<div class="md-table-wrap"><table>');
  html = html.replace(/<\/table>/g, "</table></div>");

  // Wrap <pre><code> with language header + copy button. Also annotate the
  // first <code> inside with data-md-block-path tokens so consumers can hook
  // click-to-open behavior on file references inside code blocks.
  html = html.replace(
    /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match: string, lang: string | undefined, code: string) => {
      const language = lang || "code";
      const annotated = annotateBlockPathTokens(code);
      return `<div class="md-code-block" data-language="${language}"><div class="code-block-header"><span class="lang-label">${language}</span><button type="button" class="copy-btn" title="Copy code"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div><pre><code class="language-${language}">${annotated}</code></pre></div>`;
    },
  );

  return html;
}

// Wraps any path-looking substring in a span carrying `data-md-block-path` so
// the rendered HTML is still safe (DOMPurify allows the attr) but consumers
// can attach click handlers to navigate to the referenced file.
function annotateBlockPathTokens(code: string): string {
  BLOCK_PATH_TOKEN_RE.lastIndex = 0;
  const matches: Array<{ start: number; end: number; raw: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = BLOCK_PATH_TOKEN_RE.exec(code)) !== null) {
    if (match[0] && isLikelyFilePath(match[0])) {
      matches.push({ start: match.index, end: match.index + match[0].length, raw: match[0] });
    }
  }
  if (matches.length === 0) return code;
  // Walk the string in reverse so indexes stay valid as we splice.
  let result = code;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end, raw } = matches[i];
    result = result.slice(0, start)
      + `<span data-md-block-path="${raw.replace(/"/g, "&quot;")}">${raw}</span>`
      + result.slice(end);
  }
  return result;
}

// ── Build full HTML from markdown string ────────────────────────────

function renderMarkdown(text: string): string {
  if (!text) return "";
  const raw = marked.parse(text, { async: false }) as string;
  const clean = purify(raw);
  return decorateHtml(clean);
}

// ── Copy-button handler (event delegation) ──────────────────────────

function setupCopyHandler(container: HTMLElement): () => void {
  const handler = (e: MouseEvent) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(".copy-btn");
    if (!btn) return;
    const block = btn.closest(".md-code-block");
    const code = block?.querySelector("code");
    if (!code) return;
    const text = code.textContent ?? "";
    const original = btn.innerHTML;
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      btn.setAttribute("title", "Copied");
      setTimeout(() => {
        btn.innerHTML = original;
        btn.setAttribute("title", "Copy code");
      }, 1400);
    });
  };
  container.addEventListener("click", handler);
  return () => container.removeEventListener("click", handler);
}

// ── Markdown component ───────────────────────────────────────────────

interface MarkdownProps {
  children: string;
  /** Called when the user clicks on a path-looking token inside a code block. */
  onOpenPath?: (path: string) => void;
}

export function Markdown({ children, onOpenPath }: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevHtmlRef = useRef("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const html = renderMarkdown(children);
    if (html === prevHtmlRef.current) return; // skip if unchanged
    prevHtmlRef.current = html;

    // First render: set innerHTML directly
    if (!container.hasChildNodes()) {
      container.innerHTML = html;
      return;
    }

    // Subsequent renders: morphdom patches only changes (OpenChamber-style)
    const temp = document.createElement("div");
    temp.innerHTML = html;
    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => !fromEl.isEqualNode(toEl),
    });
  }, [children]);

  // Wire up delegated copy handler once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return setupCopyHandler(container);
  }, []);

  // Wire up delegated click handler for annotated file references inside code
  // blocks. The path token carries the raw ref (with optional line/col suffix);
  // the consumer is responsible for resolving it against the active cwd.
  useEffect(() => {
    if (!onOpenPath) return;
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const token = target?.closest<HTMLElement>("[data-md-block-path]");
      if (!token) return;
      const raw = token.getAttribute("data-md-block-path");
      if (!raw) return;
      e.preventDefault();
      onOpenPath(raw);
    };
    container.addEventListener("click", handler);
    return () => container.removeEventListener("click", handler);
  }, [onOpenPath]);

  return <div ref={containerRef} className="markdown-body" />;
}
