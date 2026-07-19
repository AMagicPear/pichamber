import { useMemo, useState } from "react";
import { Files, FolderOpen, History, Plus, Search, Settings, TerminalSquare } from "lucide-react";

export interface PaletteAction { id: string; label: string; hint?: string; icon: "open" | "new" | "files" | "terminal" | "history" | "settings"; run(): void }
const icons = { open: FolderOpen, new: Plus, files: Files, terminal: TerminalSquare, history: History, settings: Settings };

export function CommandPalette({ actions, onClose }: { actions: PaletteAction[]; onClose(): void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase())), [actions, query]);
  return <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette"><div className="palette-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "Enter" && filtered[0]) { filtered[0].run(); onClose(); } }} placeholder="Type a command" /></div><div className="palette-list">{filtered.map((action) => { const Icon = icons[action.icon]; return <button key={action.id} onClick={() => { action.run(); onClose(); }}><Icon size={15} /><span>{action.label}</span>{action.hint && <kbd>{action.hint}</kbd>}</button>; })}{filtered.length === 0 && <div className="panel-empty">No matching commands</div>}</div></section></div>;
}
