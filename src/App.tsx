import { lazy, Suspense, useEffect, useState } from "react";
import { Files, PanelLeft, Plus, Settings, TerminalSquare, X } from "lucide-react";
import { Toaster } from "sonner";
import { IconButton } from "./components/IconButton";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { ChatView } from "./features/chat/ChatView";
import { Composer } from "./features/chat/Composer";
import { UiRequestDialog } from "./features/chat/UiRequestDialog";
import { Inspector } from "./features/files/Inspector";
import { SettingsModal } from "./features/settings/SettingsModal";
import { Sidebar } from "./features/workspace/Sidebar";
import { SessionBrowser } from "./features/workspace/SessionBrowser";
import { usePichamber } from "./runtime/use-pichamber";
import { useAppStore } from "./stores/app-store";

const TerminalDock = lazy(() => import("./features/terminal/TerminalDock").then((module) => ({ default: module.TerminalDock })));

export default function App() {
  const state = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeSession = state.sessions.find((session) => session.id === state.activeSessionId);
  const activeProject = state.projects.find((project) => project.id === activeSession?.projectId) ?? state.projects.find((project) => project.id === state.activeProjectId);
  const messages = activeSession ? state.messages[activeSession.id] ?? [] : [];
  const runtimeRunning = activeSession?.running ?? false;

  const actions = usePichamber(activeSession, activeProject);

  useEffect(() => {
    const dark = state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [state.theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteActions: PaletteAction[] = [
    { id: "open", label: "Open project", icon: "open", run: () => void actions.openProjectAndActivate() },
    ...(activeProject ? [{ id: "new", label: "New session", icon: "new" as const, hint: "⌘N", run: () => state.addSession(activeProject.id) }] : []),
    { id: "files", label: "Toggle files", icon: "files", run: state.toggleInspector },
    { id: "terminal", label: "Toggle terminal", icon: "terminal", run: state.toggleTerminal },
    { id: "history", label: "Session history", icon: "history", run: () => setHistoryOpen(true) },
    { id: "settings", label: "Open settings", icon: "settings", run: () => setSettingsOpen(true) },
  ];

  return <div className={`app-shell ${state.sidebarOpen ? "with-sidebar" : ""} ${state.inspectorOpen ? "with-inspector" : ""}`}>
    {state.sidebarOpen && <Sidebar projects={state.projects} sessions={state.sessions} activeProjectId={state.activeProjectId} activeSessionId={state.activeSessionId}
      onOpenProject={() => void actions.openProjectAndActivate()} onNewSession={state.addSession} onSession={state.setActiveSession} onClose={state.toggleSidebar}
      onSettings={() => setSettingsOpen(true)} onHistory={() => setHistoryOpen(true)} onRename={actions.renameSession} onFork={(session) => void actions.forkSession(session)}
      onDelete={(session) => void actions.deleteSession(session)} onRemoveProject={(project) => void actions.removeProject(project)} />}
    <main className="workspace">
      <header className="workspace-header">
        <div aria-hidden data-tauri-drag-region="deep" className="drag-layer" />
        <div className="header-left no-drag">
          {!state.sidebarOpen && <IconButton label="Show sidebar" onClick={state.toggleSidebar}><PanelLeft size={17} /></IconButton>}
          <div className="session-tabs">{actions.tabs.map((tab) => <button key={tab.id} className={`session-tab ${tab.id === activeSession?.id ? "active" : ""}`} onClick={() => state.setActiveSession(tab.id)}>
            <span>{tab.title}</span>
            <span role="button" aria-label={`Close ${tab.title}`} onClick={(event) => { event.stopPropagation(); actions.closeActiveTab(tab.id); }}><X size={13} /></span>
          </button>)}{activeProject && <IconButton label="New session" onClick={() => state.addSession(activeProject.id)}><Plus size={16} /></IconButton>}</div>
        </div>
        <div className="header-actions no-drag">
          <span className={`runtime-indicator ${runtimeRunning ? "running" : ""}`}>{runtimeRunning ? "Pi working" : activeProject ? "Ready" : "No project"}</span>
          <IconButton label="Toggle files" onClick={state.toggleInspector}><Files size={17} /></IconButton>
          <IconButton label="Toggle terminal" onClick={state.toggleTerminal}><TerminalSquare size={17} /></IconButton>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}><Settings size={17} /></IconButton>
        </div>
      </header>
      {state.runtimeError && <div className="runtime-error"><span>{state.runtimeError}</span><button onClick={() => state.setRuntimeError(undefined)}>Dismiss</button></div>}
      <div className="workspace-body">
        <div className="chat-pane">
          <ChatView messages={messages} projectName={activeProject?.name} onOpenFile={(path) => void actions.openFile(path)} onSuggestion={(text) => void actions.sendPrompt(text)} />
          <Composer disabled={!activeProject || !activeSession} running={runtimeRunning} models={state.models} selectedModel={state.selectedModel} thinkingLevel={state.thinkingLevel}
            onModel={actions.pickModel} onThinking={actions.setThinking} onSend={actions.sendPrompt} onStop={actions.stopPrompt} onAttach={actions.attachFile} />
        </div>
        {state.inspectorOpen && <Inspector project={activeProject} file={state.openFile} onFile={(path) => void actions.openFile(path)} onClose={state.toggleInspector} />}
      </div>
      {state.terminalOpen && <Suspense fallback={<div className="terminal-loading">Starting terminal...</div>}><TerminalDock cwd={activeProject?.path} onClose={state.toggleTerminal} /></Suspense>}
    </main>
    {settingsOpen && <SettingsModal theme={state.theme} thinkingLevel={state.thinkingLevel} piPath={state.piPath} onTheme={state.setTheme} onThinking={state.setThinkingLevel} onPiPath={state.setPiPath} onClose={() => setSettingsOpen(false)} />}
    {historyOpen && <SessionBrowser project={activeProject} onResume={(session) => { if (activeProject) state.resumeSession(activeProject.id, session.path, session.name ?? "Resumed session"); setHistoryOpen(false); }} onClose={() => setHistoryOpen(false)} />}
    {state.uiRequest && <UiRequestDialog request={state.uiRequest} onAnswer={actions.answerUiRequest} />}
    {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
    <Toaster theme={state.theme === "system" ? "system" : state.theme} position="bottom-right" />
  </div>;
}