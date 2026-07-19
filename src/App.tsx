import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { Composer } from "./features/chat/Composer";
import { ChatView } from "./features/chat/ChatView";
import { UiRequestDialog } from "./features/chat/UiRequestDialog";
import { Inspector } from "./features/files/Inspector";
import { SettingsModal } from "./features/settings/SettingsModal";
import { Sidebar } from "./features/workspace/Sidebar";
import { WorkspaceHeader } from "./features/workspace/WorkspaceHeader";
import { usePichamber } from "./runtime/use-pichamber";
import { useAppStore } from "./stores/app-store";

const TerminalDock = lazy(() => import("./features/terminal/TerminalDock").then((module) => ({ default: module.TerminalDock })));

export default function App() {
  const state = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeSession = state.sessions.find((s) => s.id === state.activeSessionId);
  const cwd = activeSession?.projectId;
  const messages = activeSession ? state.messages[activeSession.id] ?? [] : [];
  const attachments = activeSession ? state.attachments[activeSession.id] ?? [] : [];
  const runtimeRunning = activeSession?.running ?? false;

  const actions = usePichamber();

  useEffect(() => {
    const dark = state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [state.theme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteActions: PaletteAction[] = [
    ...(cwd ? [{ id: "new", label: "New session", icon: "new" as const, hint: "⌘N", run: () => actions.newSession(cwd) }] : []),
    { id: "files", label: "Toggle files", icon: "files", run: state.toggleInspector },
    { id: "terminal", label: "Toggle terminal", icon: "terminal", run: state.toggleTerminal },
    { id: "settings", label: "Open settings", icon: "settings", run: () => setSettingsOpen(true) },
  ];

  return (
    <div className={`app-shell ${state.sidebarOpen ? "with-sidebar" : ""} ${state.inspectorOpen ? "with-inspector" : ""}`}>
      {state.sidebarOpen && (
        <Sidebar
          onOpenSession={actions.openSession}
          onNewSession={actions.newSession}
          onClose={state.toggleSidebar}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      <main className="workspace">
        <WorkspaceHeader
          activeSession={activeSession}
          activeProject={cwd ? { id: cwd, name: cwd.split("/").pop() ?? cwd, path: cwd } : undefined}
          canCreateSession={Boolean(cwd)}
          sidebarOpen={state.sidebarOpen}
          inspectorOpen={state.inspectorOpen}
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
              onOpenFile={(path) => void actions.openFile(path)}
              onSuggestion={(text) => void actions.sendPrompt(text)}
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
      <Toaster theme={state.theme === "system" ? "system" : state.theme} position="bottom-right" />
    </div>
  );
}