import { Brain, ChevronDown, Files, PanelLeft, Plus, Settings, TerminalSquare } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ModelInfo, Project, SessionTab, ThinkingLevel } from "../../runtime/types";

interface Props {
  activeSession?: SessionTab;
  activeProject?: Project;
  canCreateSession: boolean;
  sidebarOpen: boolean;
  terminalOpen: boolean;
  runtimeRunning: boolean;
  // Header model & thinking pills (OpenChamber-style, like the composer pills)
  models?: ModelInfo[];
  selectedModel?: ModelInfo;
  thinkingLevel?: ThinkingLevel;
  onModel?(model: ModelInfo): void;
  onThinking?(level: ThinkingLevel): void;
  onToggleSidebar(): void;
  onNewSession(): void;
  onToggleInspector(): void;
  onToggleTerminal(): void;
  onOpenSettings(): void;
}

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "X-High",
};

const displayModel = (model: ModelInfo): string => {
  const slash = model.id.indexOf("/");
  return slash >= 0 ? model.id.slice(slash + 1) : model.id;
};

export function WorkspaceHeader(props: Props) {
  const projectLabel = props.activeProject?.name;
  const sessionLabel = props.activeSession?.title ?? (projectLabel ? "New session" : "No session selected");
  const isPiSession = props.activeSession?.sessionPath != null;
  const showModelPill = (props.models?.length ?? 0) > 0 && Boolean(props.onModel);
  const showThinkingPill = props.thinkingLevel !== undefined && Boolean(props.onThinking);

  return (
    <header className="workspace-header">
      <div className="header-left">
        {!props.sidebarOpen && (
          <IconButton label="Show sidebar" className="tiny" onClick={props.onToggleSidebar}>
            <PanelLeft size={17} />
          </IconButton>
        )}
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
      <div className="header-spacer" />
      <div className="header-actions">
        {/* Runtime status indicator (OpenChamber-style pill) */}
        <span className={`runtime-indicator ${props.runtimeRunning ? "running" : ""}`}>
          <span className="dot" />
          {props.runtimeRunning ? "Pi working" : isPiSession ? "Idle" : "New"}
        </span>

        {/* OpenChamber-style header model pill */}
        {showModelPill && props.selectedModel && props.onModel && (
          <label className="header-model-pill" title="Change model">
            <span className="pill-text">{displayModel(props.selectedModel)}</span>
            <ChevronDown size={10} className="pill-chevron" />
            <select
              aria-label="Model"
              value={props.selectedModel.id}
              onChange={(e) => {
                const next = props.models?.find((m) => m.id === e.target.value);
                if (next) props.onModel?.(next);
              }}
            >
              {props.models?.map((m) => (
                <option key={m.id} value={m.id}>{displayModel(m)}</option>
              ))}
            </select>
          </label>
        )}

        {/* OpenChamber-style header thinking pill */}
        {showThinkingPill && props.onThinking && (
          <label className={`header-thinking-pill ${props.thinkingLevel !== "off" ? "is-active" : ""}`} title="Thinking level">
            <Brain size={11} />
            <span className="pill-text">{THINKING_LABELS[props.thinkingLevel!]}</span>
            <ChevronDown size={10} className="pill-chevron" />
            <select
              aria-label="Thinking level"
              value={props.thinkingLevel}
              onChange={(e) => props.onThinking?.(e.target.value as ThinkingLevel)}
            >
              {Object.entries(THINKING_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        )}

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
