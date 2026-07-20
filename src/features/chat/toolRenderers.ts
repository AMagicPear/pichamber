// Tool output renderers — trimmed port of OpenChamber's `toolRenderers.tsx`.
// Exposes the helpers the enhanced ToolBlock needs without pulling in
// OpenChamber's full icon sprite or base-UI menus.

export const coerceToText = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
};

/**
 * Detect whether a tool's output string is JSON (object or array). Used to
 * switch the renderer between a syntax-highlighted view and a navigable tree.
 */
export const tryParseJsonOutput = (output: string): { isJson: boolean; data: unknown } => {
  if (!output) return { isJson: false, data: undefined };
  const trimmed = output.trim();
  if (!trimmed) return { isJson: false, data: undefined };
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return { isJson: false, data: undefined };
  try {
    return { isJson: true, data: JSON.parse(trimmed) };
  } catch {
    return { isJson: false, data: undefined };
  }
};

/**
 * Best-effort language detection for syntax highlighting. Mirrors the
 * heuristic OpenChamber uses for common CLI tools — fall back to "text" when
 * nothing matches so the highlight worker never crashes.
 */
export const detectLanguageFromOutput = (
  output: string,
  tool: string,
): string => {
  const t = tool.toLowerCase();
  if (t === "bash" || t === "shell" || t === "execute" || t === "cmd" || t === "terminal") {
    return "bash";
  }
  const trimmed = output.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* not JSON */
    }
  }
  if (/^(diff|--- |\+\+\+ |@@ )/m.test(trimmed)) return "diff";
  if (/<\/?[a-z][^>]*>/i.test(trimmed) && /<\/[a-z]+\s*>/i.test(trimmed)) return "html";
  return "text";
};

/**
 * Format edit/write tool output by stripping Pi's `<file>` envelope and
 * `00000|` line-prefix noise so the body is just the file content.
 */
export const formatEditOutput = (output: string): string => {
  if (!output) return "";
  let cleaned = output.replace(/^<file>\s*\n?/, "").replace(/\n?<\/file>\s*$/, "");
  cleaned = cleaned.replace(/^\s*\d{5}\|\s?/gm, "");
  return cleaned.trim();
};

/**
 * One-line human description for the input row, used in tool summaries.
 * Mirrors OpenChamber's `formatToolInput` but only knows about the Pi-shaped
 * inputs we actually see (command/path/query/url/content/etc).
 */
export const formatToolInput = (
  input: Record<string, unknown> | undefined,
  toolName = "",
): string => {
  if (!input || typeof input !== "object") return "";
  const t = toolName.toLowerCase();
  if (t === "bash" || t === "shell" || t === "execute") {
    const cmd = input.command ?? input.cmd;
    if (typeof cmd === "string") {
      const firstLine = cmd.split("\n")[0] ?? "";
      return firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine;
    }
  }
  if (t === "read" || t === "view" || t === "write" || t === "edit" || t === "apply_patch") {
    const p = input.path ?? input.filePath ?? input.file_path;
    if (typeof p === "string") return p;
  }
  if (t === "grep" || t === "search" || t === "find" || t === "ripgrep") {
    const q = input.pattern ?? input.query ?? input.regex;
    if (typeof q === "string") return q.length > 80 ? q.slice(0, 80) + "…" : q;
  }
  if (t === "fetch" || t === "webfetch") {
    const u = input.url ?? input.uri;
    if (typeof u === "string") return u;
  }
  if (t === "task") {
    const d = input.description ?? input.prompt;
    if (typeof d === "string") return d.length > 80 ? d.slice(0, 80) + "…" : d;
  }
  // Generic fallback: pick the first string-valued key.
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value.length > 80 ? value.slice(0, 80) + "…" : value;
    }
  }
  return "";
};

/**
 * Show a relative path inside the tool summary. Strips a known prefix so
 * `/Users/me/projects/pichamber/src/foo.ts` becomes `src/foo.ts`.
 */
export const getRelativePath = (absolutePath: string, currentDirectory: string): string => {
  if (!absolutePath) return "";
  const normalized = absolutePath.replace(/\\/g, "/");
  if (!currentDirectory) return normalized;
  const dir = currentDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized === dir) return ".";
  const prefix = `${dir}/`;
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  return normalized;
};

export { coerceToText as _coerceToText };