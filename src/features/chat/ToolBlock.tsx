import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCode,
  FileSearch,
  FileText,
  FolderSearch,
  Globe,
  ListChecks,
  LoaderCircle,
  Pencil,
  Search as SearchIcon,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { Markdown } from "../../components/Markdown";
import { IconButton } from "../../components/IconButton";
import type { ToolActivity } from "../../runtime/types";
import { getToolMetadata } from "../../vendor/openchamber/lib/toolHelpers";
import {
  coerceToText,
  detectLanguageFromOutput,
  formatEditOutput,
  formatToolInput,
  getRelativePath,
  tryParseJsonOutput,
} from "./toolRenderers";

const ICON_CLASS = "h-3.5 w-3.5 flex-shrink-0";

function toolIcon(name: string) {
  const t = name.toLowerCase();
  if (t === "edit" || t === "multiedit" || t === "apply_patch" || t === "str_replace" || t === "str_replace_based_edit_tool") {
    return <Pencil className={ICON_CLASS} />;
  }
  if (t === "write" || t === "create" || t === "file_write") {
    return <FileCode className={ICON_CLASS} />;
  }
  if (t === "read" || t === "view" || t === "file_read" || t === "cat") {
    return <FileText className={ICON_CLASS} />;
  }
  if (t === "bash" || t === "shell" || t === "cmd" || t === "terminal" || t === "execute") {
    return <SquareTerminal className={ICON_CLASS} />;
  }
  if (t === "list" || t === "ls" || t === "dir" || t === "list_files") {
    return <FolderSearch className={ICON_CLASS} />;
  }
  if (t === "search" || t === "grep" || t === "find" || t === "ripgrep") {
    return <SearchIcon className={ICON_CLASS} />;
  }
  if (t === "glob") {
    return <FileSearch className={ICON_CLASS} />;
  }
  if (
    t === "fetch"
    || t === "curl"
    || t === "wget"
    || t === "webfetch"
    || t === "web-search"
    || t === "websearch"
    || t === "search_web"
  ) {
    return <Globe className={ICON_CLASS} />;
  }
  if (t === "todowrite" || t === "todoread") {
    return <ListChecks className={ICON_CLASS} />;
  }
  return <Wrench className={ICON_CLASS} />;
}

const MAX_DURATION_MS = 5 * 60 * 1000;
const formatDuration = (start: number, end?: number, now = Date.now()) => {
  const duration = Math.min(Math.max(0, (end ?? now) - start), MAX_DURATION_MS);
  const seconds = duration / 1000;
  const displaySeconds = seconds < 0.05 && end !== undefined ? 0.1 : seconds;
  return `${displaySeconds.toFixed(1)}s`;
};

const useNow = (active: boolean, intervalMs = 250): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
};

type JsonView = "summary" | "formatted" | "raw";

const JsonSummary = ({ data }: { data: unknown }) => {
  if (data === null) return <span className="tool-output-json-summary">null</span>;
  if (typeof data !== "object") {
    return <span className="tool-output-json-summary">{String(data)}</span>;
  }
  if (Array.isArray(data)) {
    return (
      <ul className="tool-output-json-summary">
        {data.slice(0, 12).map((item, i) => (
          <li key={i}>{summarize(item)}</li>
        ))}
        {data.length > 12 ? <li className="tool-output-json-more">+{data.length - 12} more…</li> : null}
      </ul>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>).slice(0, 12);
  return (
    <ul className="tool-output-json-summary">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="tool-output-json-key">{k}</span>: {summarize(v)}
        </li>
      ))}
      {Object.keys(data as Record<string, unknown>).length > 12 ? (
        <li className="tool-output-json-more">+{Object.keys(data as Record<string, unknown>).length - 12} more…</li>
      ) : null}
    </ul>
  );
};

const summarize = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > 80 ? `"${value.slice(0, 80)}…"` : `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") return `Object(${Object.keys(value as Record<string, unknown>).length})`;
  return String(value);
};

const JsonTree = ({ data, depth = 0 }: { data: unknown; depth?: number }) => {
  if (data === null || typeof data !== "object") {
    return <span className="tool-output-json-tree">{summarize(data)}</span>;
  }
  const isArray = Array.isArray(data);
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(data as Record<string, unknown>);
  return (
    <ul className="tool-output-json-tree">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="tool-output-json-key">{k}</span>:{" "}
          {v === null || typeof v !== "object" ? (
            summarize(v)
          ) : (
            <JsonTree data={v} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
};

const JsonRaw = ({ text }: { text: string }) => (
  <pre className="tool-output-json-raw">{text}</pre>
);

interface ToolBlockProps {
  tool: ToolActivity;
  onOpenFile: (path: string) => void;
  /** Active working directory. Strips the prefix off absolute paths so the
   *  tool summary shows short relative paths (OpenChamber-style). */
  cwd?: string;
}

export function ToolBlock({ tool, onOpenFile, cwd }: ToolBlockProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [jsonView, setJsonView] = useState<JsonView>("summary");

  const input = tool.input;
  const isRunning = tool.status === "running";
  const now = useNow(isRunning);

  const toolMeta = useMemo(() => getToolMetadata(tool.name), [tool.name]);
  const displayName = toolMeta.displayName || tool.name;

  const descriptionPath = useMemo(() => {
    if (!input) return undefined;
    const p = input.path ?? input.filePath ?? input.file_path;
    if (typeof p === "string") return p;
    return undefined;
  }, [input]);

  const description = useMemo(
    () => formatToolInput(input, tool.name),
    [input, tool.name],
  );

  const relativeDescription = useMemo(() => {
    if (descriptionPath && cwd) {
      return getRelativePath(descriptionPath, cwd);
    }
    return description;
  }, [description, descriptionPath, cwd]);

  const outputText = useMemo(() => {
    const raw = coerceToText(tool.output);
    return toolMeta.outputLanguage === "diff" ? formatEditOutput(raw) : raw;
  }, [tool.output, toolMeta.outputLanguage]);

  const jsonResult = useMemo(() => tryParseJsonOutput(outputText), [outputText]);
  const outputLanguage = useMemo(
    () => detectLanguageFromOutput(outputText, tool.name),
    [outputText, tool.name],
  );

  const durationLabel = formatDuration(tool.startedAt, tool.endedAt, now);
  const hasError = tool.status === "error" || !!tool.error;

  return (
    <div className={`tool-block ${hasError ? "error" : isRunning ? "running" : "complete"}`}>
      <button
        type="button"
        className="tool-row"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={`tool-disclosure${open ? " open" : ""}`}>
          {open ? <ChevronRight size={12} /> : toolIcon(tool.name)}
        </span>
        <span className="tool-name">{displayName}</span>
        {relativeDescription ? (
          <span className="tool-label" title={description}>{relativeDescription}</span>
        ) : null}
        <span className="tool-duration" title={`Started ${new Date(tool.startedAt).toLocaleTimeString()}`}>
          {durationLabel}
        </span>
        <span className="tool-status">
          {isRunning ? (
            <LoaderCircle className="spin" size={12} />
          ) : hasError ? (
            <CircleAlert size={12} />
          ) : (
            <Check size={12} />
          )}
        </span>
      </button>
      {open && (hasError || outputText || descriptionPath) ? (
        <div className="tool-output-wrap open">
          <div className="tool-output-inner">
            {descriptionPath ? (
              <div className="tool-output-meta">
                <button
                  type="button"
                  className="tool-output-path"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (descriptionPath) onOpenFile(descriptionPath);
                  }}
                >
                  <FileCode size={11} /> {descriptionPath}
                </button>
              </div>
            ) : null}
            {hasError && tool.error ? (
              <pre className="tool-output tool-output-error">{tool.error}</pre>
            ) : null}
            {!hasError && outputText ? (
              <ToolOutputBody
                tool={tool}
                jsonResult={jsonResult}
                outputText={outputText}
                outputLanguage={outputLanguage}
                jsonView={jsonView}
                onJsonViewChange={setJsonView}
                onOpenFile={onOpenFile}
                cwd={cwd}
                copied={copied}
                onCopy={async () => {
                  try {
                    await navigator.clipboard.writeText(outputText);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ToolOutputBody = ({
  tool,
  jsonResult,
  outputText,
  outputLanguage,
  jsonView,
  onJsonViewChange,
  onOpenFile,
  cwd,
  copied,
  onCopy,
}: {
  tool: ToolActivity;
  jsonResult: { isJson: boolean; data: unknown };
  outputText: string;
  outputLanguage: string;
  jsonView: JsonView;
  onJsonViewChange: (view: JsonView) => void;
  onOpenFile: (path: string) => void;
  cwd?: string;
  copied: boolean;
  onCopy: () => void;
}) => {
  // For task / generic tools, prefer markdown rendering so the output reads
  // like prose. Heuristic: tool name suggests text content (task, question,
  // fetch returning markdown, etc).
  const t = tool.name.toLowerCase();
  const renderAsMarkdown = t === "task" || t === "question" || outputLanguage === "markdown";
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onJsonViewChange("summary");
  }, [outputText, onJsonViewChange]);

  if (renderAsMarkdown) {
    return (
      <div className="tool-output tool-output-markdown">
        <Markdown>{outputText}</Markdown>
      </div>
    );
  }

  if (jsonResult.isJson) {
    return (
      <div className="tool-output tool-output-json">
        <div className="tool-output-actions">
          <button
            type="button"
            className={`tool-output-action${jsonView === "summary" ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); onJsonViewChange("summary"); }}
            title="Summary"
          >
            <ListChecks size={11} />
          </button>
          <button
            type="button"
            className={`tool-output-action${jsonView === "formatted" ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); onJsonViewChange("formatted"); }}
            title="Formatted"
          >
            <FileCode size={11} />
          </button>
          <button
            type="button"
            className={`tool-output-action${jsonView === "raw" ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); onJsonViewChange("raw"); }}
            title="Raw"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            className="tool-output-action"
            onClick={(e) => { e.stopPropagation(); onCopy(); }}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
        <div ref={contentRef} className="tool-output-json-body">
          {jsonView === "summary" ? <JsonSummary data={jsonResult.data} /> : null}
          {jsonView === "formatted" ? <JsonTree data={jsonResult.data} /> : null}
          {jsonView === "raw" ? <JsonRaw text={outputText} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="tool-output tool-output-text">
      <div className="tool-output-actions">
        <button
          type="button"
          className="tool-output-action"
          onClick={(e) => { e.stopPropagation(); onCopy(); }}
          title={copied ? "Copied" : "Copy"}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
      <ClickableFileOutput text={outputText} onOpenFile={onOpenFile} cwd={cwd} />
    </div>
  );
};

// IconButton is no longer used inside ToolBlock (the path is inlined as a
// button-styled link inside the metadata row) but kept re-exported so other
// modules importing it for fallback styles keep working.
export { IconButton };

// ── Clickable file paths in tool output ────────────────────────────────

/** Known file extensions — used to spot plausible file paths in output. */
const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "jsonl",
  "css", "scss", "less", "html", "htm", "xml", "svg", "md", "mdx",
  "py", "rs", "go", "java", "kt", "swift", "c", "cpp", "h", "hpp",
  "rb", "php", "sh", "bash", "zsh", "fish", "yaml", "yml", "toml",
  "ini", "cfg", "conf", "env", "gitignore", "dockerfile", "makefile",
  "sql", "graphql", "proto", "vue", "svelte", "astro", "elm",
  "lua", "r", "rmd", "rmarkdown", "tex", "nim", "zig", "odin",
  "cs", "fs", "fsx", "vb", "ps1", "psm1", "bat", "cmd",
  "lock", "toml", "prisma", "wasm", "wat", "wgsl",
]);

/**
 * Check whether a string looks like a relative or absolute file path with a
 * recognised extension.
 */
function looksLikeFilePath(s: string): boolean {
  if (!s.includes("/") && !s.includes("\\")) return false;
  const dot = s.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = s.slice(dot + 1).toLowerCase();
  // Also accept dotted filenames without extension (e.g. .gitignore)
  if (s.startsWith(".") && dot === 0) return true;
  return CODE_EXTS.has(ext);
}

/** Grep-style output: `path:line` or `path:line:col` */
const GREP_RE = /^(\S+?):(\d+)(?::(\d+))?[:\s](.*)$/;

interface ClickableFileOutputProps {
  text: string;
  onOpenFile(path: string): void;
  cwd?: string;
}

function ClickableFileOutput({ text, onOpenFile, cwd }: ClickableFileOutputProps) {
  const lines = text.split("\n");

  // For grep/search/glob tools, try to detect the path pattern.
  // Heuristic: if the first non-empty line matches a grep pattern or looks
  // like a file path, treat the whole output as path-rich.
  const firstLine = lines.find((l) => l.trim()) ?? "";
  const usesGrepFormat = GREP_RE.test(firstLine);
  const usesFilePathFormat = looksLikeFilePath(firstLine.trim());
  const shouldLinkPaths = usesGrepFormat || usesFilePathFormat;

  if (!shouldLinkPaths) {
    return <pre className="tool-output-text-pre">{text}</pre>;
  }

  const renderLine = (line: string, i: number): ReactNode => {
    if (usesGrepFormat) {
      const m = line.match(GREP_RE);
      if (m) {
        const [, path, lineNum, , rest] = m;
        const displayPath = cwd ? getRelativePath(path!, cwd) : path!;
        return (
          <span key={i} className="tool-output-line">
            <button
              type="button"
              className="tool-output-path-link"
              onClick={(e) => { e.stopPropagation(); onOpenFile(path!); }}
              title={`Open ${path}`}
            >
              {displayPath}:{lineNum}
            </button>
            <span className="tool-output-line-rest">{rest}</span>
          </span>
        );
      }
    }

    const trimmed = line.trim();
    if (usesFilePathFormat && looksLikeFilePath(trimmed)) {
      const displayPath = cwd ? getRelativePath(trimmed, cwd) : trimmed;
      return (
        <span key={i} className="tool-output-line">
          <button
            type="button"
            className="tool-output-path-link"
            onClick={(e) => { e.stopPropagation(); onOpenFile(trimmed); }}
            title={`Open ${trimmed}`}
          >
            {displayPath}
          </button>
        </span>
      );
    }

    return <span key={i} className="tool-output-line">{line}</span>;
  };

  return (
    <pre className="tool-output-text-pre tool-output-text-linked">
      {lines.map((line, i) => renderLine(line, i))}
    </pre>
  );
}