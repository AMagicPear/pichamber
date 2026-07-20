// Decorate the sanitized HTML produced by `markdownCore` before it lands in the
// DOM. A trimmed-down port of OpenChamber's `decorate.ts` — we keep the parts
// that materially affect visual parity (code block card + language header +
// copy button + table wrapper + block path annotations) and drop the parts that
// pull in heavier dependencies (Mermaid viewer registry, dropdown menus,
// icon sprite, file reference stat-cache, JSX popup layers). Those will land
// in later stages once Pichamber vendors the matching UI primitives.
//
// All decoration runs as a single string→string pass so it composes with the
// per-block morphdom reconciliation in `markdownCore.ts`.

const KNOWN_FILE_BASENAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  ".env",
  ".gitignore",
  ".npmrc",
]);

// Mirrors OpenChamber's `BLOCK_PATH_TOKEN_RE` — matches `path[:line[:col]]`
// or `path:start-end` inside shell/grep-style output for paths that contain a
// file extension. We annotate these so consumers can wire up click-to-open.
const BLOCK_PATH_TOKEN_RE = /(?:[A-Za-z]:[\\/])?[\w.\-/@+]*[\w\-/@+]\.[A-Za-z0-9]{1,8}(?::\d+(?:-\d+)?(?::\d+)?)?/g;

const isLikelyFilePath = (value: string): boolean => {
  if (!value || value.startsWith("--") || value.includes("://")) return false;
  if (/[<>]/.test(value) || /\s{2,}/.test(value)) return false;
  const base = (value.split(/[\\/]/).filter(Boolean).pop() ?? "").toLowerCase();
  if (!base || base === "." || base === "..") return false;
  if (KNOWN_FILE_BASENAMES.has(base) || (base.startsWith(".") && base.length > 1)) return true;
  return /\.[A-Za-z0-9_-]{1,16}$/.test(base);
};

const annotateBlockPathTokens = (code: string): string => {
  BLOCK_PATH_TOKEN_RE.lastIndex = 0;
  const matches: Array<{ start: number; end: number; raw: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = BLOCK_PATH_TOKEN_RE.exec(code)) !== null) {
    if (match[0] && isLikelyFilePath(match[0])) {
      matches.push({ start: match.index, end: match.index + match[0].length, raw: match[0] });
    }
  }
  if (matches.length === 0) return code;
  let result = code;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end, raw } = matches[i];
    result =
      result.slice(0, start)
      + `<span data-md-block-path="${raw.replace(/"/g, "&quot;")}">${raw}</span>`
      + result.slice(end);
  }
  return result;
};

const escapeAttr = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const COPY_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const CHECK_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

/**
 * Walk the sanitized HTML string and wrap code blocks / tables so the rendered
 * output matches OpenChamber's visual treatment: a framed card with a language
 * label + copy button for code, a horizontally scrollable container for
 * tables, and `data-md-block-path` annotations on file-looking substrings
 * inside fenced code.
 */
export function decorateHtml(html: string): string {
  if (!html) return html;

  // Wrap tables for horizontal overflow on narrow viewports.
  let out = html.replace(/<table>/g, '<div class="md-table-wrap"><table>');
  out = out.replace(/<\/table>/g, "</table></div>");

  // Decorate fenced code blocks. Two source shapes need to be handled:
  //   (a) `marked` + `renderMarkdownSync` — `<pre><code class="language-X">…`
  //   (b) Shiki worker output — `<pre data-md-lang="X" class="shiki …"><code>…`
  // We unwrap the Shiki <code> wrapper, replace it with a `language-X` class so
  // the stylesheet targets the same selector, and wrap everything in the
  // OpenChamber-style framed card + header bar.
  out = out.replace(
    /<pre(?:\s+data-md-lang="([^"]*)")?(?:\s+class="shiki[^"]*")?\s+style="[^"]*"><code>([\s\S]*?)<\/code><\/pre>|<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match: string, shikiLang: string | undefined, shikiBody: string | undefined, langAttr: string | undefined, plainBody: string | undefined) => {
      const language = (shikiLang || langAttr || "code").toString();
      const rawBody = (shikiBody ?? plainBody ?? "").toString();
      const annotated = annotateBlockPathTokens(rawBody);
      return `<div class="md-code-block" data-language="${escapeAttr(language)}"><div class="code-block-header"><span class="lang-label">${escapeAttr(language)}</span><button type="button" class="copy-btn" title="Copy code" aria-label="Copy code">${COPY_ICON_SVG}</button></div><pre class="language-${escapeAttr(language)} shiki openchamber-md" data-md-lang="${escapeAttr(language)}" style="background-color:transparent;color:var(--md-syntax-foreground)"><code class="language-${escapeAttr(language)}">${annotated}</code></pre></div>`;
    },
  );

  return out;
}

export { CHECK_ICON_SVG, COPY_ICON_SVG };