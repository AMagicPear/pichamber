import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { closeRuntime, getRuntime } from "./registry";
import { normalizeBackendMessages } from "./normalize";
import { deleteSession as apiDeleteSession, workspaceReadFile, createSession } from "../api/client";
import type { ModelInfo, OpenFile, ThinkingLevel } from "./types";
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

// Each Pi session we have open has a Pichamber-local tab id. We use a hash of
// the session path so it's stable across restarts and short enough to fit the
// Rust instance-id validation (≤256 chars, no slashes).
function sessionKey(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    hash = ((hash << 5) - hash + c) | 0;
  }
  return `pi:${Math.abs(hash).toString(36)}`;
}

export function usePichamber() {
  const state = useAppStore();
  const subscriptions = useRef(new Map<string, () => void>());
  const activeSessionCwd = useRef<string | undefined>(undefined);

  // Detach all event listeners on unmount.
  useEffect(() => () => { subscriptions.current.forEach((unsubscribe) => unsubscribe()); }, []);

  const ensureRuntime = useCallback(async (key: string, cwd: string, sessionPath?: string) => {
    const client = getRuntime(key);
    if (!subscriptions.current.has(key)) {
      const unsubscribe = client.onEvent((event) => {
        const next = useAppStore.getState();
        next.reduceRuntimeEvent(key, event);
        if (event.type === "agent_start") next.setSessionRunning(key, true);
        if (["agent_end", "rpc_disconnected"].includes(String(event.type))) next.setSessionRunning(key, false);
        if (event.type === "extension_ui_request" && event.method === "notify") toast(String(event.message ?? event.title ?? "Pi notification"));
      });
      subscriptions.current.set(key, unsubscribe);
    }
    if (!client.connected) {
      await client.start(cwd, state.piPath || undefined);
      if (sessionPath) {
        await client.request({ type: "switch_session", sessionPath });
        const history = await client.request<{ messages: unknown[] }>({ type: "get_messages" });
        state.hydrateMessages(key, normalizeBackendMessages(history.messages ?? []));
      }
      const modelData = await client.request<{ models: ModelInfo[] }>({ type: "get_available_models" }).catch(() => ({ models: [] }));
      state.setModels(modelData.models ?? []);

      // Restore the session's model & thinking level from Pi state
      // Pi returns model as nested object: { model: { provider, id, ... } }
      if (sessionPath) {
        const sessionState = await client.request<{
          model?: { provider: string; id: string };
          thinkingLevel?: ThinkingLevel;
        }>({ type: "get_state" }).catch((): { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } => ({}));
        if (sessionState.thinkingLevel) {
          state.setThinkingLevel(sessionState.thinkingLevel);
        }
        const stateModelId = sessionState.model?.id;
        if (stateModelId && modelData.models) {
          const found = modelData.models.find((m) => m.id === stateModelId);
          if (found) state.setSelectedModel(found);
        }
      }
    }
    return client;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId]);

  // Auto-start the runtime when the active session changes.
  useEffect(() => {
    const key = state.activeSessionId;
    if (!key) return;
    const session = state.sessions.find((s) => s.id === key);
    if (!session?.sessionPath) return; // not a Pi session — nothing to start

    const cwd = session.projectId; // we store cwd in projectId for Pi sessions
    // Set loading if no messages yet (avoid flashing on tab switch to loaded tabs)
    const existing = state.messages[key];
    if (!existing || existing.length === 0) {
      state.setSessionLoading(key, true);
    }
    let cancelled = false;
    void ensureRuntime(key, cwd, session.sessionPath).catch((error) => {
      if (!cancelled) state.setRuntimeError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId]);

  /**
   * Open an existing Pi session from disk. Called by the Sidebar when the user
   * clicks a session row.
   */
  const openSession = useCallback((sessionPath: string, cwd: string, title: string) => {
    const key = sessionKey(sessionPath);
    state.openPiSession(key, cwd, title, sessionPath);
    state.setSessionLoading(key, true);
    activeSessionCwd.current = cwd;
  }, [state]);

  /**
   * Start a brand-new Pi session in the given working directory. Calls the
   * server to allocate a session file path, then opens a tab for it. Pi will
   * create the `.jsonl` file on disk when it first switches to the session.
   */
  const newSession = useCallback(async (cwd: string) => {
    // Pi creates the actual session file on first prompt — we just ensure
    // the directory exists and open a tab. The session file will be
    // auto-discovered by the sidebar when Pi writes it.
    const dir = await createSession(cwd).then((r) => r.dir).catch(() => undefined);
    const key = `new:${sessionKey(cwd)}:${Date.now()}`;
    state.openPiSession(key, cwd, `Session in ${cwd.split("/").pop() ?? cwd}`);
    activeSessionCwd.current = cwd;
  }, [state]);

  const sendPrompt = useCallback(async (text: string) => {
    const key = state.activeSessionId;
    if (!key) return;
    const session = state.sessions.find((s) => s.id === key);
    if (!session) return;
    const cwd = session.projectId; // cwd stored in projectId
    const attachments = state.attachments[key] ?? [];
    const message = attachments.length > 0 ? `${text}\n\n${attachments.map((p) => `@${p}`).join("\n")}` : text;
    state.addUserMessage(key, message, attachments);
    state.removeAllAttachments(key);
    state.setRuntimeError(undefined);
    try {
      const client = await ensureRuntime(key, cwd, session.sessionPath);
      state.setSessionRunning(key, true);
      await client.request({ type: "prompt", message, streamingBehavior: "followUp" });
    } catch (error) {
      state.setSessionRunning(key, false);
      state.setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [state, ensureRuntime]);

  const stopPrompt = useCallback(() => {
    const key = state.activeSessionId;
    if (!key) return;
    // Immediately mark as not running so the UI reflects the stop right away.
    state.setSessionRunning(key, false);
    // Fire-and-forget: don't wait for a response — Pi may be busy streaming
    // and the abort may not get an explicit acknowledgement.
    getRuntime(key).send({ type: "abort" }).catch(() => {
      // If send itself fails (e.g. disconnected), the runtime will emit
      // rpc_disconnected which already clears the running flag.
    });
  }, [state]);

  const pickModel = useCallback((model: ModelInfo) => {
    state.setSelectedModel(model);
    const key = state.activeSessionId;
    if (key && getRuntime(key).connected) {
      void getRuntime(key).request({ type: "set_model", provider: model.provider, modelId: model.id }).then(() =>
        getRuntime(key).request<{ thinkingLevel?: ThinkingLevel }>({ type: "get_state" })
      ).then((sessionState) => {
        if (sessionState?.thinkingLevel) {
          state.setThinkingLevel(sessionState.thinkingLevel);
        }
      }).catch(() => {});
    }
  }, [state]);

  const setThinking = useCallback((level: ThinkingLevel) => {
    state.setThinkingLevel(level);
    const key = state.activeSessionId;
    if (key && getRuntime(key).connected) {
      void getRuntime(key).request({ type: "set_thinking_level", level }).then(() =>
        getRuntime(key).request<{ thinkingLevel?: ThinkingLevel }>({ type: "get_state" })
      ).then((sessionState) => {
        if (sessionState?.thinkingLevel && sessionState.thinkingLevel !== level) {
          state.setThinkingLevel(sessionState.thinkingLevel);
          toast(`Thinking set to ${sessionState.thinkingLevel} (${level} not available for this model)`);
        }
      }).catch(() => {});
    }
  }, [state]);

  // OpenChamber-style regenerate: resend the last user prompt
  const regeneratePrompt = useCallback(async () => {
    const key = state.activeSessionId;
    if (!key) return;
    const messages = state.messages[key] ?? [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      toast.error("Nothing to regenerate");
      return;
    }
    await sendPrompt(lastUser.text);
  }, [state, sendPrompt]);

  const openFile = useCallback(async (path: string) => {
    const cwd = activeSessionCwd.current;
    if (!cwd) return;
    try {
      const file = await workspaceReadFile(cwd, path).catch(() => demoOpenFile(path));
      state.setOpenFile(file);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }, [state]);

  const attachFile = useCallback(async (): Promise<string | undefined> => {
    const key = state.activeSessionId;
    if (!key) return undefined;
    const cwd = state.sessions.find((s) => s.id === key)?.projectId;
    if (!cwd) return undefined;
    const p = await new Promise<string | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) resolve(file.name);
        else resolve(null);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!p) return undefined;
    if (!pathInsideProject(cwd, p)) {
      // The file picker only gives us the filename, so we trust it's in the project
    }
    const relative = pathInsideProject(cwd, p) ? relativeFromProject(cwd, p) : p;
    state.addAttachment(key, relative);
    return relative;
  }, [state]);

  const answerUiRequest = useCallback((value: string | boolean | undefined) => {
    const request = state.uiRequest;
    const key = state.activeSessionId;
    if (!request || !key) return;
    const payload = value === undefined ? { type: "extension_ui_response", id: request.id, cancelled: true }
      : request.method === "confirm" ? { type: "extension_ui_response", id: request.id, confirmed: value }
      : { type: "extension_ui_response", id: request.id, value };
    void getRuntime(key).send(payload);
    state.setUiRequest(undefined);
  }, [state]);

  const renameSession = useCallback(async () => {
    const key = state.activeSessionId;
    if (!key) return;
    const session = state.sessions.find((s) => s.id === key);
    if (!session) return;
    const title = window.prompt("Session name", session.title)?.trim();
    if (!title) return;
    state.renameSession(key, title);
    if (getRuntime(key).connected) void getRuntime(key).request({ type: "set_session_name", name: title });
  }, [state]);

  // Sidebar-driven rename: called when the user commits the inline rename
  // input next to a Pi session row. Looks up the matching open tab (if any)
  // and pushes the new name both to the local store and the Pi runtime.
  const renameSessionByPath = useCallback(async (sessionPath: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const tab = state.sessions.find((s) => s.sessionPath === sessionPath);
    if (tab) state.renameSession(tab.id, trimmed);
    const key = tab?.id ?? sessionKey(sessionPath);
    if (getRuntime(key).connected) {
      void getRuntime(key).request({ type: "set_session_name", name: trimmed }).catch((error) => {
        console.warn("Failed to push session rename to Pi:", error);
      });
    }
  }, [state]);

  const forkSession = useCallback(async () => {
    const key = state.activeSessionId;
    if (!key) return;
    const session = state.sessions.find((s) => s.id === key);
    if (!session) return;
    const cwd = session.projectId;
    try {
      const client = await ensureRuntime(key, cwd, session.sessionPath);
      const data = await client.request<{ messages?: Array<{ id?: string; entryId?: string }> }>({ type: "get_fork_messages" });
      const entry = data.messages?.at(-1);
      const entryId = entry?.entryId ?? entry?.id;
      if (!entryId) throw new Error("This session does not have a forkable turn yet");
      await client.request({ type: "fork", entryId });
      const history = await client.request<{ messages: unknown[] }>({ type: "get_messages" });
      state.hydrateMessages(key, normalizeBackendMessages(history.messages ?? []));
      state.renameSession(key, `${session.title} (fork)`);
      toast.success("Forked from the latest turn");
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }, [state, ensureRuntime]);

  const deleteSession = useCallback(async () => {
    const key = state.activeSessionId;
    if (!key) return;
    const session = state.sessions.find((s) => s.id === key);
    if (!session) return;
    if (!window.confirm(`Delete “${session.title}”? This cannot be undone.`)) return;
    subscriptions.current.get(key)?.(); subscriptions.current.delete(key);
    await closeRuntime(key);
    if (session.sessionPath) await apiDeleteSession(session.sessionPath).catch((error) => toast.error(String(error)));
    state.closeSession(key);
    state.setRuntimeError(undefined);
  }, [state]);

  return {
    openSession,
    newSession,
    sendPrompt,
    regeneratePrompt,
    stopPrompt,
    pickModel,
    setThinking,
    openFile,
    attachFile,
    answerUiRequest,
    renameSession,
    renameSessionByPath,
    forkSession,
    deleteSession,
  };
}
