import { useState } from "react";
import { Check, ChevronRight, CircleAlert, FileCode, LoaderCircle, TerminalSquare, Wrench } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ToolActivity } from "../../runtime/types";

export function ToolBlock({ tool, onOpenFile }: { tool: ToolActivity; onOpenFile(path: string): void }) {
  const [open, setOpen] = useState(false);
  const path = typeof tool.input?.path === "string" ? tool.input.path : undefined;
  const statusIcon = tool.status === "running" ? <LoaderCircle className="spin" size={14} /> : tool.status === "error" ? <CircleAlert size={14} /> : <Check size={14} />;
  const label = path ?? (typeof tool.input?.command === "string" ? tool.input.command : "");
  return <div className={`tool-block ${tool.status}`}><div className="tool-row">
    <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="tool-disclosure">{open ? <ChevronRight className="rotated" size={14} /> : tool.name.toLowerCase().includes("bash") ? <TerminalSquare size={14} /> : <Wrench size={14} />}</span>
      <span className="tool-name">{tool.name}</span>
      <span className="tool-label">{label}</span>
      <span className="tool-status">{statusIcon}</span>
    </button>{path && <IconButton label={`Open ${path}`} onClick={() => onOpenFile(path)}><FileCode size={14} /></IconButton>}</div>
    {open && <pre className="tool-output">{JSON.stringify(tool.output ?? tool.input ?? {}, null, 2)}</pre>}
  </div>;
}

