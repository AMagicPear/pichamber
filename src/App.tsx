import { lazy, Suspense, useEffect, useState } from "react";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { Toaster } from "./components/Toaster";
import { Composer } from "./features/chat/Composer";
import { ChatView } from "./features/chat/ChatView";
import { UiRequestDialog } from "./features/chat/UiRequestDialog";
import { Inspector } from "./features/files/Inspector";
import { SettingsModal } from "./features/settings/SettingsModal";
import { Sidebar } from "./features/workspace/Sidebar";
import { WorkspaceHeader } from "./features/workspace/WorkspaceHeader";
import { usePichamber } from "./runtime/use-pichamber";
import { useAppStore } from "./stores/app-store";
import { useResizable } from "./hooks/use-resizable";
import { listAllSessionsGrouped } from "./api/client";

const TerminalDock = lazy(() => import("./features/terminal/TerminalDock").then((module) => ({ default: module.TerminalDock })));

export default function App() {
  const state = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId);
  const cwd = activeSession?.projectId;
  const messages = state.view.messages;
  const runningTools = state.view.runningTools;
  const sessionLoading = state.sessionLoading;
  const isStreaming = state.view.state.isStreaming;
  const thinkingLevel = state.view.state.thinkingLevel;
  const selectedModel = state.view.state.model ?? state.models[0];

  const actions = usePichamber();

  const sidebarResize = useResizable({
    min: 200,
    max: 480,
    initial: state.sidebarWidth,
    edge: "right",
    cssVar: "--sidebar-w",
    onResize: state.setSidebarWidth,
  });
  const inspectorResize = useResizable({
    min: 300,
    max: 800,
    initial: state.inspectorWidth,
    edge: "left",
    cssVar: "--inspector-w",
    onResize: state.setInspectorWidth,
  });

  useEffect(() => {
    let cancelled = false;
    listAllSessionsGrouped()
      .then((groups) => { if (!cancelled) state.setSessionGroups(groups); })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.setSessionGroups]);

  useEffect(() => {
    const dark = state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [state.theme, state.theme === "system"]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); state.toggleSidebar(); }
      if (event.key === "Escape" && isStreaming) { event.preventDefault(); actions.stopPrompt(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isStreaming, actions]);

  const paletteActions: PaletteAction[] = [
    ...(cwd ? [{ id: "new", label: "New session", icon: "new" as const, hint: "⌘N", run: () => void actions.newSession(cwd) }] : []),
    { id: "files", label: "Toggle files", icon: "files", run: state.toggleInspector },
    ...(activeSession ? [{ id: "rename", label: "Rename session", icon: "settings" as const, run: () => void actions.renameSession() }] : []),
    ...(activeSession ? [{ id: "delete", label: "Delete session", icon: "settings" as const, run: () => void actions.deleteSession() }] : []),
    { id: "terminal", label: "Toggle terminal", icon: "terminal", run: state.toggleTerminal },
    { id: "settings", label: "Open settings", icon: "settings", run: () => setSettingsOpen(true) },
  ];

  return (
    <div className={`app-shell${state.sidebarOpen ? " with-sidebar" : ""}${state.inspectorOpen ? " with-inspector" : ""}`}>
      <Sidebar
        isOpen={state.sidebarOpen}
        width={state.sidebarWidth}
        panelRef={sidebarResize.panelRef}
        resizeHandleRef={sidebarResize.handleRef}
        resizeDragging={sidebarResize.dragging}
        onResizeMouseDown={sidebarResize.onMouseDown}
        activeSessionPath={activeSession?.sessionPath ?? null}
        sessionGroups={state.sessionGroups}
        onOpenSession={actions.openSession}
        onNewSession={actions.newSession}
        onRenameSession={actions.renameSessionByPath}
        onClose={state.toggleSidebar}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace">
        <WorkspaceHeader
          activeSession={activeSession}
          activeProject={cwd ? { id: cwd, name: cwd.split("/").pop() ?? cwd, path: cwd } : undefined}
          canCreateSession={Boolean(cwd)}
          sidebarOpen={state.sidebarOpen}
          terminalOpen={state.terminalOpen}
          runtimeRunning={isStreaming}
          onToggleSidebar={state.toggleSidebar}
          onNewSession={() => cwd && void actions.newSession(cwd)}
          onToggleInspector={state.toggleInspector}
          onToggleTerminal={state.toggleTerminal}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {state.error && (
          <div className="runtime-error">
            <span>{state.error}</span>
            <button onClick={() => state.setError(undefined)}>Dismiss</button>
          </div>
        )}
        <div className="workspace-body">
          <div className="chat-pane">
            <ChatView
              messages={messages}
              runningTools={runningTools}
              projectName={cwd ? cwd.split("/").pop() : undefined}
              cwd={cwd}
              loading={sessionLoading}
              onOpenFile={(path) => void actions.openFile(path)}
              onSuggestion={(text) => { void actions.sendPrompt(text); }}
            />
            <Composer
              disabled={!activeSession}
              running={isStreaming}
              models={state.models}
              selectedModel={selectedModel}
              thinkingLevel={thinkingLevel}
              onModel={actions.pickModel}
              onThinking={actions.setThinking}
              onSend={(text) => void actions.sendPrompt(text)}
              onStop={actions.stopPrompt}
            />
          </div>
          {state.inspectorOpen && (
            <Inspector
              project={cwd ? { id: cwd, name: cwd.split("/").pop() ?? cwd, path: cwd } : undefined}
              file={state.openFile}
              width={state.inspectorWidth}
              panelRef={inspectorResize.panelRef}
              resizeHandleRef={inspectorResize.handleRef}
              resizeDragging={inspectorResize.dragging}
              onResizeMouseDown={inspectorResize.onMouseDown}
              onFile={(path) => path ? void actions.openFile(path) : state.setOpenFile(undefined)}
              onClose={state.toggleInspector}
            />
          )}
        </div>
        {state.terminalOpen && (
          <Suspense fallback={<div className="terminal-loading">Starting terminal…</div>}>
            <TerminalDock cwd={cwd} onClose={state.toggleTerminal} />
          </Suspense>
        )}
      </main>
      {settingsOpen && (
        <SettingsModal
          theme={state.theme}
          thinkingLevel={thinkingLevel}
          piPath={state.piPath}
          onTheme={state.setTheme}
          onThinking={state.setThinkingLevel}
          onPiPath={state.setPiPath}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {state.uiRequest && <UiRequestDialog request={state.uiRequest} onAnswer={actions.answerUiRequest} />}
      {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
      <Toaster />
    </div>
  );
}
