import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { closeRuntime, getRuntime } from "./registry";
import { normalizeBackendMessages } from "./normalize";
import { isTauri, native, openProject } from "./tauri";
import type { ModelInfo, OpenFile, Project, SessionTab, ThinkingLevel } from "./types";
import { useAppStore } from "../stores/app-store";

const DEMO_FILES: Record<string, string> = {
  "src/App.tsx": "export function App() {\n  return <main>Pichamber</main>;\n}\n",
  "src/styles.css": ":root {\n  color-scheme: light dark;\n}\n",
  "README.md": "# Pichamber\n\nA desktop workspace for the Pi Coding Agent.\n",
  "package.json": "{\n  \"name\": \"pichamber\",\n  \"version\": \"0.1.0\"\n}\n",
};

const demoOpenFile = (path: string): OpenFile => {
  const content = DEMO_FILES[path] ?? `// ${path}\n`;
  return { path, content, size: content.length, truncated: false };
};

const pathInsideProject = (projectPath: string, candidate: string): boolean => {
  const root = projectPath.replace(/[\\/]+$/, "");
  return candidate === root || candidate.startsWith(`${root}/`) || candidate.startsWith(`${root}\\`);
};

const relativeFromProject = (projectPath: string, absolute: string): string =>
  absolute.slice(projectPath.replace(/[\\/]+$/, "").length).replace(/^[\\/]/, "").replaceAll("\\", "/");

export function usePichamber(activeSession?: SessionTab, activeProject?: Project) {
  const state = useAppStore();
  const subscriptions = useRef(new Map<string, () => void>());

  // Detach all event listeners on unmount.
  useEffect(() => () => { subscriptions.current.forEach((unsubscribe) => unsubscribe()); }, []);

  // Ensure the runtime for a session is started exactly once and subscribed to events.
  const ensureRuntime = useCallback(async (session: SessionTab, project: Project) => {
    const client = getRuntime(session.id);
    if (!subscriptions.current.has(session.id)) {
      const unsubscribe = client.onEvent((event) => {
        const next = useAppStore.getState();
        next.reduceRuntimeEvent(session.id, event);
        if (event.type === "agent_start") next.setSessionRunning(session.id, true);
        if (["agent_end", "rpc_disconnected"].includes(String(event.type))) next.setSessionRunning(session.id, false);
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
    // The closure intentionally only re-binds when the active session changes; runtime state changes must not restart hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, activeSession?.sessionPath, activeProject?.id]);

  // Initial history hydration when a resumed session is selected.
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

  const openProjectAndActivate = useCallback(async () => {
    const project = await openProject();
    if (!project) return;
    state.addProject(project);
    const existing = state.sessions.find((session) => session.projectId === project.id);
    if (existing) state.setActiveSession(existing.id); else state.addSession(project.id);
  }, [state]);

  const sendPrompt = useCallback(async (text: string) => {
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
  }, [activeSession, activeProject, state, ensureRuntime]);

  const stopPrompt = useCallback(() => {
    if (!activeSession) return;
    void getRuntime(activeSession.id).request({ type: "abort" }).then(() => state.setSessionRunning(activeSession.id, false)).catch((error) => {
      state.setRuntimeError(error instanceof Error ? error.message : String(error));
      toast.error("Pi did not confirm the stop request");
    });
  }, [activeSession, state]);

  const pickModel = useCallback((model: ModelInfo) => {
    state.setSelectedModel(model);
    if (activeSession && getRuntime(activeSession.id).connected) void getRuntime(activeSession.id).request({ type: "set_model", provider: model.provider, modelId: model.id });
  }, [activeSession, state]);

  const setThinking = useCallback((level: ThinkingLevel) => {
    state.setThinkingLevel(level);
    if (activeSession && getRuntime(activeSession.id).connected) void getRuntime(activeSession.id).request({ type: "set_thinking_level", level });
  }, [activeSession, state]);

  const openFile = useCallback(async (path: string) => {
    if (!activeProject) return;
    try {
      const file = isTauri() ? await native.readFile(activeProject.path, path) : demoOpenFile(path);
      state.setOpenFile(file);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }, [activeProject, state]);

  const attachFile = useCallback(async (): Promise<string | undefined> => {
    if (!activeProject) return undefined;
    if (!isTauri()) return "src/App.tsx";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: false, multiple: false, title: "Attach a project file", defaultPath: activeProject.path });
    if (!selected) return undefined;
    const path = String(selected);
    if (!pathInsideProject(activeProject.path, path)) { toast.error("Attachments must be inside the open project"); return undefined; }
    return relativeFromProject(activeProject.path, path);
  }, [activeProject]);

  const answerUiRequest = useCallback((value: string | boolean | undefined) => {
    const request = state.uiRequest;
    if (!request || !activeSession) return;
    const payload = value === undefined ? { type: "extension_ui_response", id: request.id, cancelled: true }
      : request.method === "confirm" ? { type: "extension_ui_response", id: request.id, confirmed: value }
      : { type: "extension_ui_response", id: request.id, value };
    void getRuntime(activeSession.id).send(payload);
    state.setUiRequest(undefined);
  }, [activeSession, state]);

  const renameSession = useCallback((session: SessionTab) => {
    const title = window.prompt("Session name", session.title)?.trim();
    if (!title) return;
    state.renameSession(session.id, title);
    const client = getRuntime(session.id);
    if (client.connected) void client.request({ type: "set_session_name", name: title });
  }, [state]);

  const forkSession = useCallback(async (session: SessionTab) => {
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
  }, [state, ensureRuntime]);

  const deleteSession = useCallback(async (session: SessionTab) => {
    if (!window.confirm(`Delete “${session.title}”? This cannot be undone.`)) return;
    subscriptions.current.get(session.id)?.(); subscriptions.current.delete(session.id);
    await closeRuntime(session.id);
    if (session.sessionPath && isTauri()) await native.deleteSession(session.sessionPath).catch((error) => toast.error(String(error)));
    state.closeSession(session.id);
    state.setRuntimeError(undefined);
  }, [state]);

  const removeProject = useCallback(async (project: Project) => {
    if (!window.confirm(`Remove “${project.name}” from Pichamber? Project files will not be deleted.`)) return;
    for (const session of state.sessions.filter((session) => session.projectId === project.id)) {
      subscriptions.current.get(session.id)?.(); subscriptions.current.delete(session.id);
      await closeRuntime(session.id);
    }
    state.removeProject(project.id);
  }, [state]);

  const tabs = useMemo(
    () => state.sessions.filter((session) => !activeProject || session.projectId === activeProject.id),
    [state.sessions, activeProject],
  );

  const closeActiveTab = useCallback((id: string) => {
    subscriptions.current.get(id)?.(); subscriptions.current.delete(id);
    void closeRuntime(id);
    state.closeSession(id);
  }, [state]);

  return {
    tabs,
    openProjectAndActivate,
    sendPrompt,
    stopPrompt,
    pickModel,
    setThinking,
    openFile,
    attachFile,
    answerUiRequest,
    renameSession,
    forkSession,
    deleteSession,
    removeProject,
    closeActiveTab,
  };
}