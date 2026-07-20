import { useEffect, useMemo, useRef, useState } from "react";
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
import type { RunningTool, ToolCall, ToolResultMessage } from "../../runtime/types";
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
  if (t === "write" || t === "create" || t === "file_write") return <FileCode className={ICON_CLASS} />;
  if (t === "read" || t === "view" || t === "file_read" || t === "cat") return <FileText className={ICON_CLASS} />;
  if (t === "bash" || t === "shell" || t === "cmd" || t === "terminal" || t === "execute") return <SquareTerminal className={ICON_CLASS} />;
  if (t === "list" || t === "ls" || t === "dir" || t === "list_files") return <FolderSearch className={ICON_CLASS} />;
  if (t === "search" || t === "grep" || t === "find" || t === "ripgrep") return <SearchIcon className={ICON_CLASS} />;
  if (t === "glob") return <FileSearch className={ICON_CLASS} />;
  if (
    t === "fetch" || t === "curl" || t === "wget" || t === "webfetch"
    || t === "web-search" || t === "websearch" || t === "search_web"
  ) return <Globe className={ICON_CLASS} />;
  if (t === "todowrite" || t === "todoread") return <ListChecks className={ICON_CLASS} />;
  return <Wrench className={ICON_CLASS} />;
}

const MAX_DURATION_MS = 5 * 60 * 1000;
const formatDuration = (start: number, end?: number, now = Date.now()) => {
  const duration = Math.min(Math.max(0, (end ?? now) - start), MAX_DURATION_MS);
  const seconds = duration / 1000;
  const display = seconds < 0.05 && end !== undefined ? 0.1 : seconds;
  return `${display.toFixed(1)}s`;
};

const useNow = (active: boolean, intervalMs = 250): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
};

type JsonView = "summary" | "formatted" | "raw";

interface ToolBlockProps {
  call: ToolCall;
  result?: ToolResultMessage;
  running?: RunningTool;
  onOpenFile(path: string): void;
  cwd?: string;
}

export function ToolBlock({ call, result, running, onOpenFile, cwd }: ToolBlockProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [jsonView, setJsonView] = useState<JsonView>("summary");

  const isRunning = !result && !!running;
  const now = useNow(isRunning);
  const hasError = result?.isError === true;
  // `ToolCall` doesn't carry a timestamp in Pi's protocol; the timing comes
  // from the live `tool_execution_start`/`end` events we track separately.
  const startedAt = running?.startedAt ?? Date.now();
  const endedAt = result?.timestamp ?? running?.endedAt;

  const toolMeta = useMemo(() => getToolMetadata(call.name), [call.name]);
  const displayName = toolMeta.displayName || call.name;

  const input = call.arguments;
  const descriptionPath = useMemo(() => {
    if (!input) return undefined;
    const p = (input as Record<string, unknown>).path
      ?? (input as Record<string, unknown>).filePath
      ?? (input as Record<string, unknown>).file_path;
    return typeof p === "string" ? p : undefined;
  }, [input]);

  const description = useMemo(
    () => formatToolInput(input as Record<string, unknown> | undefined, call.name),
    [input, call.name],
  );

  const relativeDescription = useMemo(() => {
    if (descriptionPath && cwd) return getRelativePath(descriptionPath, cwd);
    return description;
  }, [description, descriptionPath, cwd]);

  // Result text — prefer finalized result, fall back to live partial.
  const outputText = useMemo(() => {
    let raw: string;
    if (result) {
      raw = result.content
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
    } else if (running?.partialResult !== undefined) {
      raw = coerceToText(running.partialResult);
    } else {
      raw = "";
    }
    return toolMeta.outputLanguage === "diff" ? formatEditOutput(raw) : raw;
  }, [result, running?.partialResult, toolMeta.outputLanguage]);

  const jsonResult = useMemo(() => tryParseJsonOutput(outputText), [outputText]);
  const outputLanguage = useMemo(
    () => detectLanguageFromOutput(outputText, call.name),
    [outputText, call.name],
  );

  const durationLabel = formatDuration(startedAt, endedAt, now);

  return (
    <div className={`tool-block ${hasError ? "error" : isRunning ? "running" : "complete"}`}>
      <button type="button" className="tool-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`tool-disclosure${open ? " open" : ""}`}>
          {open ? <ChevronRight size={12} /> : toolIcon(call.name)}
        </span>
        <span className="tool-name">{displayName}</span>
        {relativeDescription ? <span className="tool-label" title={description}>{relativeDescription}</span> : null}
        <span className="tool-duration" title={`Started ${new Date(startedAt).toLocaleTimeString()}`}>
          {durationLabel}
        </span>
        <span className="tool-status">
          {isRunning ? <LoaderCircle className="spin" size={12} /> : hasError ? <CircleAlert size={12} /> : <Check size={12} />}
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
                  onClick={(e) => { e.stopPropagation(); if (descriptionPath) onOpenFile(descriptionPath); }}
                >
                  <FileCode size={11} /> {descriptionPath}
                </button>
              </div>
            ) : null}
            {hasError && result?.isError ? (
              <pre className="tool-output tool-output-error">{outputText}</pre>
            ) : null}
            {!hasError && outputText ? (
              <ToolOutputBody
                toolName={call.name}
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
                  } catch { /* clipboard unavailable */ }
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
  toolName,
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
  toolName: string;
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
  const t = toolName.toLowerCase();
  const renderAsMarkdown = t === "task" || t === "question" || outputLanguage === "markdown";

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
          <button type="button" className={`tool-output-action${jsonView === "summary" ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); onJsonViewChange("summary"); }} title="Summary">
            <ListChecks size={11} />
          </button>
          <button type="button" className={`tool-output-action${jsonView === "formatted" ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); onJsonViewChange("formatted"); }} title="Formatted">
            <FileCode size={11} />
          </button>
          <button type="button" className={`tool-output-action${jsonView === "raw" ? " active" : ""}`} onClick={(e) => { e.stopPropagation(); onJsonViewChange("raw"); }} title="Raw">
            <Pencil size={11} />
          </button>
          <button type="button" className="tool-output-action" onClick={(e) => { e.stopPropagation(); onCopy(); }} title={copied ? "Copied" : "Copy"}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
        </div>
        <div className="tool-output-json-body">
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
        <button type="button" className="tool-output-action" onClick={(e) => { e.stopPropagation(); onCopy(); }} title={copied ? "Copied" : "Copy"}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
      <ClickableFileOutput text={outputText} onOpenFile={onOpenFile} cwd={cwd} />
    </div>
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

const JsonSummary = ({ data }: { data: unknown }) => {
  if (data === null) return <span className="tool-output-json-summary">null</span>;
  if (typeof data !== "object") return <span className="tool-output-json-summary">{String(data)}</span>;
  if (Array.isArray(data)) {
    return (
      <ul className="tool-output-json-summary">
        {data.slice(0, 12).map((item, i) => (<li key={i}>{summarize(item)}</li>))}
        {data.length > 12 ? <li className="tool-output-json-more">+{data.length - 12} more…</li> : null}
      </ul>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>).slice(0, 12);
  return (
    <ul className="tool-output-json-summary">
      {entries.map(([k, v]) => (
        <li key={k}><span className="tool-output-json-key">{k}</span>: {summarize(v)}</li>
      ))}
      {Object.keys(data as Record<string, unknown>).length > 12 ? (
        <li className="tool-output-json-more">+{Object.keys(data as Record<string, unknown>).length - 12} more…</li>
      ) : null}
    </ul>
  );
};

const JsonTree = ({ data }: { data: unknown }) => {
  if (data === null || typeof data !== "object") return <span className="tool-output-json-tree">{summarize(data)}</span>;
  const isArray = Array.isArray(data);
  const entries = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(data as Record<string, unknown>);
  return (
    <ul className="tool-output-json-tree">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="tool-output-json-key">{k}</span>:{" "}
          {v === null || typeof v !== "object" ? summarize(v) : <JsonTree data={v} />}
        </li>
      ))}
    </ul>
  );
};

const JsonRaw = ({ text }: { text: string }) => <pre className="tool-output-json-raw">{text}</pre>;

const ClickableFileOutput = ({ text, onOpenFile, cwd }: { text: string; onOpenFile: (path: string) => void; cwd?: string }) => {
  const contentRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "A" || !target.dataset.path) return;
      e.preventDefault();
      onOpenFile(target.dataset.path);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [onOpenFile, cwd]);
  return <pre ref={contentRef} className="tool-output-pre">{text}</pre>;
};
