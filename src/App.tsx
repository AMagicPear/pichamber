import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  const messages = activeSession ? state.messages[activeSession.id] ?? [] : [];
  const sessionLoading = activeSession ? Boolean(state.sessionLoading[activeSession.id]) : false;
  const attachments = activeSession ? state.attachments[activeSession.id] ?? [] : [];
  const runtimeRunning = activeSession?.running ?? false;

  const actions = usePichamber();
  const stopRef = useRef(actions.stopPrompt);
  useEffect(() => { stopRef.current = actions.stopPrompt; }, [actions.stopPrompt]);

  // Resizable sidebar (right-edge handle)
  const sidebarResize = useResizable({
    min: 200,
    max: 480,
    initial: state.sidebarWidth,
    edge: "right",
    cssVar: "--sidebar-w",
    onResize: state.setSidebarWidth,
  });

  // Resizable inspector (left-edge handle)
  const inspectorResize = useResizable({
    min: 300,
    max: 800,
    initial: state.inspectorWidth,
    edge: "left",
    cssVar: "--inspector-w",
    onResize: state.setInspectorWidth,
  });

  // OpenChamber pattern: auto-draft / resume on startup
  const [autoDraftAttempted, setAutoDraftAttempted] = useState(false);
  useEffect(() => {
    if (autoDraftAttempted) return;
    if (state.sessions.length > 0) {
      if (!state.activeSessionId) {
        const latest = [...state.sessions].sort((a, b) => {
          const aMsg = state.messages[a.id];
          const bMsg = state.messages[b.id];
          const aTime = aMsg?.[aMsg.length - 1]?.createdAt ?? 0;
          const bTime = bMsg?.[bMsg.length - 1]?.createdAt ?? 0;
          return bTime - aTime;
        });
        if (latest.length > 0) state.setActiveSession(latest[0].id);
      }
      setAutoDraftAttempted(true);
      return;
    }
    setAutoDraftAttempted(true);
    listAllSessionsGrouped().then((groups) => {
      if (groups.length > 0) {
        const group = groups[0];
        const session = group.sessions[0];
        if (session) {
          actions.openSession(session.path, group.cwd, session.name ?? session.id.slice(0, 8));
          toast.success(`Resumed ${group.name}`);
        }
      }
    }).catch(() => { /* no sessions on disk — user needs to open a project */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dark = state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [state.theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); state.toggleSidebar(); }
      if (event.key === "Escape" && runtimeRunning) { event.preventDefault(); stopRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runtimeRunning]);

  const paletteActions: PaletteAction[] = [
    ...(cwd ? [{ id: "new", label: "New session", icon: "new" as const, hint: "⌘N", run: () => actions.newSession(cwd) }] : []),
    { id: "files", label: "Toggle files", icon: "files", run: state.toggleInspector },
    ...(activeSession ? [{ id: "rename", label: "Rename session", icon: "settings" as const, run: () => actions.renameSession() }] : []),
    ...(activeSession ? [{ id: "fork", label: "Fork session", icon: "settings" as const, run: () => actions.forkSession() }] : []),
    ...(activeSession ? [{ id: "delete", label: "Delete session", icon: "settings" as const, run: () => actions.deleteSession() }] : []),
    { id: "terminal", label: "Toggle terminal", icon: "terminal", run: state.toggleTerminal },
    { id: "settings", label: "Open settings", icon: "settings", run: () => setSettingsOpen(true) },
  ];

  const handleSuggestion = (text: string) => {
    if (!activeSession && cwd) {
      actions.newSession(cwd);
      setTimeout(() => actions.sendPrompt(text), 80);
    } else {
      void actions.sendPrompt(text);
    }
  };

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
          runtimeRunning={runtimeRunning}
          onToggleSidebar={state.toggleSidebar}
          onNewSession={() => cwd && actions.newSession(cwd)}
          onToggleInspector={state.toggleInspector}
          onToggleTerminal={state.toggleTerminal}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {state.runtimeError && (
          <div className="runtime-error">
            <span>{state.runtimeError}</span>
            <button onClick={() => state.setRuntimeError(undefined)}>Dismiss</button>
          </div>
        )}
        <div className="workspace-body">
          <div className="chat-pane">
            <ChatView
              messages={messages}
              projectName={cwd ? cwd.split("/").pop() : undefined}
              cwd={cwd}
              loading={sessionLoading}
              onOpenFile={(path) => void actions.openFile(path)}
              onSuggestion={handleSuggestion}
              onRegenerate={() => void actions.regeneratePrompt()}
              onFork={() => void actions.forkSession()}
            />
            <Composer
              disabled={!activeSession}
              running={runtimeRunning}
              models={state.models}
              selectedModel={state.selectedModel}
              thinkingLevel={state.thinkingLevel}
              attachments={attachments}
              onModel={actions.pickModel}
              onThinking={actions.setThinking}
              onAttach={actions.attachFile}
              onRemoveAttachment={(path) => activeSession && state.removeAttachment(activeSession.id, path)}
              onSend={actions.sendPrompt}
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
          thinkingLevel={state.thinkingLevel}
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
