import { useEffect, useMemo, useRef, useState } from "react";
import { Files, FolderOpen, History, Plus, Search, Settings, TerminalSquare } from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: "open" | "new" | "files" | "terminal" | "history" | "settings";
  run(): void;
}

const icons = { open: FolderOpen, new: Plus, files: Files, terminal: TerminalSquare, history: History, settings: Settings };

export function CommandPalette({ actions, onClose }: { actions: PaletteAction[]; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(
    () => actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase())),
    [actions, query],
  );

  // Keep activeIdx in range when the filter shrinks
  useEffect(() => {
    setActiveIdx((idx) => Math.min(Math.max(0, idx), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Reset to top whenever the query changes so the first match is highlighted
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Scroll the highlighted item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-palette-idx="${activeIdx}"]`);
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const runActive = (idx: number) => {
    const action = filtered[idx];
    if (!action) return;
    action.run();
    onClose();
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <Search size={17} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runActive(activeIdx);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIdx((idx) => Math.min(filtered.length - 1, idx + 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIdx((idx) => Math.max(0, idx - 1));
                return;
              }
            }}
            placeholder="Type a command"
            aria-controls="palette-list"
            aria-activedescendant={filtered[activeIdx] ? `palette-item-${filtered[activeIdx].id}` : undefined}
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
          />
        </div>
        <div className="palette-list" role="listbox" id="palette-list" ref={listRef}>
          {filtered.map((action, idx) => {
            const Icon = icons[action.icon];
            const isActive = idx === activeIdx;
            return (
              <button
                key={action.id}
                id={`palette-item-${action.id}`}
                role="option"
                aria-selected={isActive}
                data-palette-idx={idx}
                className={isActive ? "active" : ""}
                onMouseMove={() => setActiveIdx(idx)}
                onClick={() => runActive(idx)}
              >
                <Icon size={15} />
                <span>{action.label}</span>
                {action.hint && <kbd>{action.hint}</kbd>}
              </button>
            );
          })}
          {filtered.length === 0 && <div className="panel-empty">No matching commands</div>}
        </div>
      </section>
    </div>
  );
}
