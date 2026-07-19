import { Files, Plus, Settings, TerminalSquare } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { Project, SessionTab } from "../../runtime/types";

interface Props {
  activeSession?: SessionTab;
  activeProject?: Project;
  canCreateSession: boolean;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  terminalOpen: boolean;
  runtimeRunning: boolean;
  contextUsedPct?: number;
  onToggleSidebar(): void;
  onNewSession(): void;
  onToggleInspector(): void;
  onToggleTerminal(): void;
  onOpenSettings(): void;
}

export function WorkspaceHeader(props: Props) {
  const projectLabel = props.activeProject?.name;
  const sessionLabel = props.activeSession?.title ?? (projectLabel ? "New session" : "No session selected");
  return (
    <header className="workspace-header">
      <div aria-hidden data-tauri-drag-region="deep" className="drag-layer" />
      <div className="header-left no-drag">
        <span className="header-session" title={sessionLabel}>
          <span className={`session-status ${props.runtimeRunning ? "running" : ""}`} />
          <span className="header-session-title">{sessionLabel}</span>
          {projectLabel && projectLabel !== sessionLabel && (
            <span className="header-session-sub" title={props.activeProject?.path}>{projectLabel}</span>
          )}
        </span>
        <IconButton
          label="New session"
          className="tiny"
          onClick={props.onNewSession}
          disabled={!props.canCreateSession}
        >
          <Plus size={15} />
        </IconButton>
      </div>
      <div className="header-spacer" aria-hidden />
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