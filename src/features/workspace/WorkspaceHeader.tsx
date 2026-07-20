import { Files, PanelLeft, Plus, Settings, TerminalSquare } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { Project, SessionTab } from "../../runtime/types";

interface Props {
  activeSession?: SessionTab;
  activeProject?: Project;
  canCreateSession: boolean;
  sidebarOpen: boolean;
  terminalOpen: boolean;
  runtimeRunning: boolean;
  onToggleSidebar(): void;
  onNewSession(): void;
  onToggleInspector(): void;
  onToggleTerminal(): void;
  onOpenSettings(): void;
}

export function WorkspaceHeader(props: Props) {
  const projectLabel = props.activeProject?.name;
  const sessionLabel = props.activeSession?.title ?? (projectLabel ? "New session" : "No session selected");
  const isPiSession = props.activeSession?.sessionPath != null;

  return (
    <header className="workspace-header">
      <div className="header-left">
        {!props.sidebarOpen && (
          <IconButton label="Show sidebar" className="tiny" onClick={props.onToggleSidebar}>
            <PanelLeft size={17} />
          </IconButton>
        )}
        <span className="header-session" title={sessionLabel}>
          {props.runtimeRunning && <span className="session-status running" />}
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
      <div className="header-spacer" />
      <div className="header-actions">
        <span className={`runtime-indicator ${props.runtimeRunning ? "running" : ""}`}>
          <span className="dot" />
          {props.runtimeRunning ? "Pi working" : isPiSession ? "Idle" : "New"}
        </span>
        <IconButton label="Toggle files" onClick={props.onToggleInspector}>
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
