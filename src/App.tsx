import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Files, PanelLeft, Plus, Settings, TerminalSquare, X } from "lucide-react";
import { Toaster, toast } from "sonner";
import { IconButton } from "./components/IconButton";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { ChatView } from "./features/chat/ChatView";
import { Composer } from "./features/chat/Composer";
import { UiRequestDialog } from "./features/chat/UiRequestDialog";
import { Inspector } from "./features/files/Inspector";
import { SettingsModal } from "./features/settings/SettingsModal";
import { Sidebar } from "./features/workspace/Sidebar";
import { SessionBrowser } from "./features/workspace/SessionBrowser";
import { closeRuntime, getRuntime } from "./runtime/registry";
import { normalizeBackendMessages } from "./runtime/normalize";
import { isTauri, native, openProject } from "./runtime/tauri";
import type { ModelInfo, Project, SessionTab } from "./runtime/types";
import { useAppStore } from "./stores/app-store";

const demoContent: Record<string, string> = {
  "src/App.tsx": "export function App() {\n  return <main>Pichamber</main>;\n}\n",
  "src/styles.css": ":root {\n  color-scheme: light dark;\n}\n",
  "README.md": "# Pichamber\n\nA desktop workspace for the Pi Coding Agent.\n",
  "package.json": "{\n  \"name\": \"pichamber\",\n  \"version\": \"0.1.0\"\n}\n",
};

const TerminalDock = lazy(() => import("./features/terminal/TerminalDock").then((module) => ({ default: module.TerminalDock })));

export default function App() {
  const state = useAppStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const subscriptions = useRef(new Map<string, () => void>());
  const activeSession = state.sessions.find((session) => session.id === state.activeSessionId);
  const activeProject = state.projects.find((project) => project.id === activeSession?.projectId) ?? state.projects.find((project) => project.id === state.activeProjectId);
  const messages = activeSession ? state.messages[activeSession.id] ?? [] : [];
  const runtimeRunning = activeSession?.running ?? false;

  useEffect(() => {
    const dark = state.theme === "dark" || (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }, [state.theme]);

  useEffect(() => () => { subscriptions.current.forEach((unsubscribe) => unsubscribe()); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ensureRuntime = async (session: SessionTab, project: Project) => {
    const client = getRuntime(session.id);
    if (!subscriptions.current.has(session.id)) {
      const unsubscribe = client.onEvent((event) => {
        useAppStore.getState().reduceRuntimeEvent(session.id, event);
        if (event.type === "agent_start") useAppStore.getState().setSessionRunning(session.id, true);
        if (["agent_end", "rpc_disconnected"].includes(String(event.type))) useAppStore.getState().setSessionRunning(session.id, false);
        if (event.type === "extension_ui_request" && event.method === "notify") toast(String(event.message ?? event.title ?? "Pi notification"));
      });
      subscriptions.current.set(session.id, unsubscribe);
    }
    if (!client.connected) {
      await client.start(project.path, state.piPath || undefined);
      if (session.sessionPath && isTauri()) {
        await client.request({ type: "switch_session", sessionPath: session.sessionPath });
        const history = await client.request<{ messages: unknown[] }>({ type: "get_messages" });
        state.hydrateMessages(session.id, normalizeBackendMessages(history.messages ?? []));
      }
      const modelData = await client.request<{ models: ModelInfo[] }>({ type: "get_available_models" }).catch(() => ({ models: [] }));
      state.setModels(modelData.models ?? []);
    }
    return client;
  };

  useEffect(() => {
    if (!activeSession?.sessionPath || !activeProject || (state.messages[activeSession.id]?.length ?? 0) > 0) return;
    let cancelled = false;
    void ensureRuntime(activeSession, activeProject).catch((error) => {
      if (!cancelled) state.setRuntimeError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
    // Session IDs and paths are the lifecycle boundary; runtime state changes must not restart hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.sessionPath, activeProject?.id]);

  const handleOpenProject = async () => {
    const project = await openProject();
    if (!project) return;
    state.addProject(project);
    const existing = useAppStore.getState().sessions.find((session) => session.projectId === project.id);
    if (existing) state.setActiveSession(existing.id); else state.addSession(project.id);
  };

  const handleSend = async (text: string) => {
    if (!activeSession || !activeProject) return;
    state.addUserMessage(activeSession.id, text);
    state.setRuntimeError(undefined);
    try {
      const client = await ensureRuntime(activeSession, activeProject);
      state.setSessionRunning(activeSession.id, true);
      await client.request({ type: "prompt", message: text, streamingBehavior: "followUp" });
    } catch (error) {
      state.setSessionRunning(activeSession.id, false);
      state.setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStop = () => {
    if (!activeSession) return;
    void getRuntime(activeSession.id).request({ type: "abort" }).then(() => state.setSessionRunning(activeSession.id, false)).catch((error) => {
      state.setRuntimeError(error instanceof Error ? error.message : String(error));
      toast.error("Pi did not confirm the stop request");
    });
  };

  const handleModel = (model: ModelInfo) => {
    state.setSelectedModel(model);
    if (activeSession && getRuntime(activeSession.id).connected) void getRuntime(activeSession.id).request({ type: "set_model", provider: model.provider, modelId: model.id });
  };

  const handleOpenFile = async (path: string) => {
    if (!activeProject) return;
    try {
      const file = isTauri() ? await native.readFile(activeProject.path, path) : { path, content: demoContent[path] ?? `// ${path}\n`, size: demoContent[path]?.length ?? 0, truncated: false };
      state.setOpenFile(file);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  };

  const handleAttach = async () => {
    if (!activeProject) return undefined;
    if (!isTauri()) return "src/App.tsx";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: false, multiple: false, title: "Attach a project file", defaultPath: activeProject.path });
    if (!selected) return undefined;
    const path = String(selected);
    const root = activeProject.path.replace(/[\\/]+$/, "");
    if (!(path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))) { toast.error("Attachments must be inside the open project"); return undefined; }
    return path.slice(root.length).replace(/^[\\/]/, "").replaceAll("\\", "/");
  };

  const handleUiAnswer = (value: string | boolean | undefined) => {
    const request = state.uiRequest;
    if (!request || !activeSession) return;
    const payload = value === undefined ? { type: "extension_ui_response", id: request.id, cancelled: true }
      : request.method === "confirm" ? { type: "extension_ui_response", id: request.id, confirmed: value }
      : { type: "extension_ui_response", id: request.id, value };
    void getRuntime(activeSession.id).send(payload);
    state.setUiRequest(undefined);
  };

  const handleRenameSession = (session: SessionTab) => {
    const title = window.prompt("Session name", session.title)?.trim();
    if (!title) return;
    state.renameSession(session.id, title);
    const client = getRuntime(session.id);
    if (client.connected) void client.request({ type: "set_session_name", name: title });
  };

  const handleForkSession = async (session: SessionTab) => {
    const project = state.projects.find((item) => item.id === session.projectId);
    if (!project) return;
    try {
      const client = await ensureRuntime(session, project);
      const data = await client.request<{ messages?: Array<{ id?: string; entryId?: string }> }>({ type: "get_fork_messages" });
      const entry = data.messages?.at(-1);
      const entryId = entry?.entryId ?? entry?.id;
      if (!entryId) throw new Error("This session does not have a forkable turn yet");
      await client.request({ type: "fork", entryId });
      const history = await client.request<{ messages: unknown[] }>({ type: "get_messages" });
      state.hydrateMessages(session.id, normalizeBackendMessages(history.messages ?? []));
      state.renameSession(session.id, `${session.title} (fork)`);
      toast.success("Forked from the latest turn");
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  };

  const handleDeleteSession = async (session: SessionTab) => {
    if (!window.confirm(`Delete “${session.title}”? This cannot be undone.`)) return;
    subscriptions.current.get(session.id)?.(); subscriptions.current.delete(session.id);
    await closeRuntime(session.id);
    if (session.sessionPath && isTauri()) await native.deleteSession(session.sessionPath).catch((error) => toast.error(String(error)));
    state.closeSession(session.id);
    state.setRuntimeError(undefined);
  };

  const handleRemoveProject = async (project: Project) => {
    if (!window.confirm(`Remove “${project.name}” from Pichamber? Project files will not be deleted.`)) return;
    const sessions = state.sessions.filter((session) => session.projectId === project.id);
    for (const session of sessions) {
      subscriptions.current.get(session.id)?.(); subscriptions.current.delete(session.id);
      await closeRuntime(session.id);
    }
    state.removeProject(project.id);
  };

  const tabs = useMemo(() => state.sessions.filter((session) => !activeProject || session.projectId === activeProject.id), [state.sessions, activeProject]);
  const paletteActions: PaletteAction[] = [
    { id: "open", label: "Open project", icon: "open", run: () => void handleOpenProject() },
    ...(activeProject ? [{ id: "new", label: "New session", icon: "new" as const, hint: "⌘N", run: () => state.addSession(activeProject.id) }] : []),
    { id: "files", label: "Toggle files", icon: "files", run: state.toggleInspector },
    { id: "terminal", label: "Toggle terminal", icon: "terminal", run: state.toggleTerminal },
    { id: "history", label: "Session history", icon: "history", run: () => setHistoryOpen(true) },
    { id: "settings", label: "Open settings", icon: "settings", run: () => setSettingsOpen(true) },
  ];

  return <div className={`app-shell ${state.sidebarOpen ? "with-sidebar" : ""} ${state.inspectorOpen ? "with-inspector" : ""}`}>
    {state.sidebarOpen && <Sidebar projects={state.projects} sessions={state.sessions} activeProjectId={state.activeProjectId} activeSessionId={state.activeSessionId} onOpenProject={() => void handleOpenProject()} onNewSession={state.addSession} onSession={state.setActiveSession} onClose={state.toggleSidebar} onSettings={() => setSettingsOpen(true)} onHistory={() => setHistoryOpen(true)} onRename={handleRenameSession} onFork={(session) => void handleForkSession(session)} onDelete={(session) => void handleDeleteSession(session)} onRemoveProject={(project) => void handleRemoveProject(project)} />}
    <main className="workspace">
      <header className="workspace-header">
        <div aria-hidden className="drag-layer" />
        <div className="header-left no-drag">{!state.sidebarOpen && <IconButton label="Show sidebar" onClick={state.toggleSidebar}><PanelLeft size={17} /></IconButton>}<div className="session-tabs">{tabs.map((tab) => <button key={tab.id} className={`session-tab ${tab.id === activeSession?.id ? "active" : ""}`} onClick={() => state.setActiveSession(tab.id)}><span>{tab.title}</span><span role="button" aria-label={`Close ${tab.title}`} onClick={(event) => { event.stopPropagation(); subscriptions.current.get(tab.id)?.(); subscriptions.current.delete(tab.id); void closeRuntime(tab.id); state.closeSession(tab.id); }}><X size={13} /></span></button>)}{activeProject && <IconButton label="New session" onClick={() => state.addSession(activeProject.id)}><Plus size={16} /></IconButton>}</div></div>
        <div className="header-actions no-drag"><span className={`runtime-indicator ${runtimeRunning ? "running" : ""}`}>{runtimeRunning ? "Pi working" : activeProject ? "Ready" : "No project"}</span><IconButton label="Toggle files" onClick={state.toggleInspector}><Files size={17} /></IconButton><IconButton label="Toggle terminal" onClick={state.toggleTerminal}><TerminalSquare size={17} /></IconButton><IconButton label="Settings" onClick={() => setSettingsOpen(true)}><Settings size={17} /></IconButton></div>
      </header>
      {state.runtimeError && <div className="runtime-error"><span>{state.runtimeError}</span><button onClick={() => state.setRuntimeError(undefined)}>Dismiss</button></div>}
      <div className="workspace-body">
        <div className="chat-pane"><ChatView messages={messages} projectName={activeProject?.name} onOpenFile={(path) => void handleOpenFile(path)} onSuggestion={(text) => void handleSend(text)} /><Composer disabled={!activeProject || !activeSession} running={runtimeRunning} models={state.models} selectedModel={state.selectedModel} thinkingLevel={state.thinkingLevel} onModel={handleModel} onThinking={(level) => { state.setThinkingLevel(level); if (activeSession && getRuntime(activeSession.id).connected) void getRuntime(activeSession.id).request({ type: "set_thinking_level", level }); }} onSend={handleSend} onStop={handleStop} onAttach={handleAttach} /></div>
        {state.inspectorOpen && <Inspector project={activeProject} file={state.openFile} onFile={(path) => void handleOpenFile(path)} onClose={state.toggleInspector} />}
      </div>
      {state.terminalOpen && <Suspense fallback={<div className="terminal-loading">Starting terminal...</div>}><TerminalDock cwd={activeProject?.path} onClose={state.toggleTerminal} /></Suspense>}
    </main>
    {settingsOpen && <SettingsModal theme={state.theme} thinkingLevel={state.thinkingLevel} piPath={state.piPath} onTheme={state.setTheme} onThinking={state.setThinkingLevel} onPiPath={state.setPiPath} onClose={() => setSettingsOpen(false)} />}
    {historyOpen && <SessionBrowser project={activeProject} onResume={(session) => { if (activeProject) state.resumeSession(activeProject.id, session.path, session.name ?? "Resumed session"); setHistoryOpen(false); }} onClose={() => setHistoryOpen(false)} />}
    {state.uiRequest && <UiRequestDialog request={state.uiRequest} onAnswer={handleUiAnswer} />}
    {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
    <Toaster theme={state.theme === "system" ? "system" : state.theme} position="bottom-right" />
  </div>;
}

