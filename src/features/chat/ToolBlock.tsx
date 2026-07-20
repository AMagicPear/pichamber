import { useState } from "react";
import { Check, ChevronRight, CircleAlert, FileCode, LoaderCircle, TerminalSquare, Wrench } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ToolActivity } from "../../runtime/types";

function formatToolOutput(value: unknown, maxLen = 2000): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    if (value.length > maxLen) return value.slice(0, maxLen) + "\n… truncated";
    return value;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length > maxLen) return json.slice(0, maxLen) + "\n… truncated";
    return json;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

function shortenedLabel(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  if (typeof input.path === "string") return input.path;
  if (typeof input.filePath === "string") return input.filePath;
  if (typeof input.command === "string") {
    const cmd = input.command;
    return cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;
  }
  if (typeof input.url === "string") return input.url;
  if (typeof input.query === "string") return input.query.length > 60 ? input.query.slice(0, 60) + "…" : input.query;
  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.name === "string") return input.name;
  const keys = Object.keys(input).filter(k => k !== "path" && k !== "command");
  if (keys.length > 0) {
    const firstVal = input[keys[0]];
    if (typeof firstVal === "string") return firstVal.length > 60 ? firstVal.slice(0, 60) + "…" : firstVal;
  }
  return "";
}

function toolIcon(toolName: string) {
  const name = toolName.toLowerCase();
  if (name.includes("bash") || name.includes("shell") || name.includes("execute")) return <TerminalSquare size={14} />;
  if (name.includes("read") || name.includes("edit") || name.includes("write") || name.includes("apply_patch") || name.includes("grep")) return <FileCode size={14} />;
  return <Wrench size={14} />;
}

export function ToolBlock({ tool, onOpenFile }: { tool: ToolActivity; onOpenFile(path: string): void }) {
  const [open, setOpen] = useState(false);

  const path = typeof tool.input?.path === "string" ? tool.input.path
    : typeof tool.input?.filePath === "string" ? tool.input.filePath
    : undefined;

  const statusIcon = tool.status === "running"
    ? <LoaderCircle className="spin" size={14} />
    : tool.status === "error"
      ? <CircleAlert size={14} />
      : <Check size={14} />;

  const label = shortenedLabel(tool.input);

  return (
    <div className={`tool-block ${tool.status}`}>
      <div className="tool-row">
        <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`tool-disclosure${open ? " open" : ""}`}>
            {open ? <ChevronRight size={14} /> : toolIcon(tool.name)}
          </span>
          <span className="tool-name">{tool.name}</span>
          {label && <span className="tool-label">{label}</span>}
          <span className="tool-status">{statusIcon}</span>
        </button>
        {path && (
          <IconButton label={`Open ${path}`} onClick={() => onOpenFile(path)}>
            <FileCode size={14} />
          </IconButton>
        )}
      </div>
      <div className={`tool-output-wrap${open ? " open" : ""}`}>
        <div className="tool-output-inner">
          <pre className="tool-output">
            {formatToolOutput(tool.output ?? tool.input ?? {})}
          </pre>
        </div>
      </div>
    </div>
  );
}
