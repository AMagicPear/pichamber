import { Files, PanelLeft, Plus, Settings, TerminalSquare, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { SessionTab } from "../../runtime/types";

interface Props {
  tabs: SessionTab[];
  activeSessionId: string | null;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  terminalOpen: boolean;
  runtimeRunning: boolean;
  contextUsedPct?: number;
  onToggleSidebar(): void;
  onSelectSession(id: string): void;
  onCloseSession(id: string): void;
  onNewSession(): void;
  onToggleInspector(): void;
  onToggleTerminal(): void;
  onOpenSettings(): void;
}

export function WorkspaceHeader(props: Props) {
  return (
    <header className="workspace-header">
      <div aria-hidden data-tauri-drag-region="deep" className="drag-layer" />
      <div className="header-left no-drag">
        {!props.sidebarOpen && (
          <IconButton label="Show sidebar" className="tiny" onClick={props.onToggleSidebar}>
            <PanelLeft size={16} />
          </IconButton>
        )}
        <div className="session-tabs">
          {props.tabs.map((tab) => (
            <button
              key={tab.id}
              className={`session-tab ${tab.id === props.activeSessionId ? "active" : ""}`}
              onClick={() => props.onSelectSession(tab.id)}
            >
              <span>{tab.title}</span>
              <span
                className="session-close"
                role="button"
                aria-label={`Close ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCloseSession(tab.id);
                }}
              >
                <X size={12} />
              </span>
            </button>
          ))}
          <IconButton label="New session" className="tiny" onClick={props.onNewSession}>
            <Plus size={15} />
          </IconButton>
        </div>
      </div>
      <div className="header-actions no-drag">
        <span className={`runtime-indicator ${props.runtimeRunning ? "running" : ""}`}>
          <span className="dot" />
          {props.runtimeRunning ? "Pi working" : "Idle"}
        </span>
        {typeof props.contextUsedPct === "number" && (
          <span className="header-context-pill">
            Context <span className="pct">{Math.round(props.contextUsedPct)}%</span>
          </span>
        )}
        <span className="separator-v" />
        <IconButton label="Toggle files" className={props.inspectorOpen ? "is-active" : ""} onClick={props.onToggleInspector}>
          <Files size={17} />
        </IconButton>
        <IconButton label="Toggle terminal" className={props.terminalOpen ? "is-active" : ""} onClick={props.onToggleTerminal}>
          <TerminalSquare size={17} />
        </IconButton>
        <IconButton label="Settings" onClick={props.onOpenSettings}>
          <Settings size={17} />
        </IconButton>
      </div>
    </header>
  );
}