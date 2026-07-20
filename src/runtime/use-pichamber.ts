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

  // Detach all event listeners on unmount.
  useEffect(() => () => { subscriptions.current.forEach((unsubscribe) => unsubscribe()); }, []);

  const ensureRuntime = useCallback(async (key: string, cwd: string, sessionPath?: string) => {
    const client = getRuntime(key);
    if (!subscriptions.current.has(key)) {
      const unsubscribe = client.onEvent((event) => {
        const next = useAppStore.getState();
        next.reduceRuntimeEvent(key, event);
        if (event.type === "agent_start") next.setSessionRunning(key, true);
        if (["agent_end", "rpc_disconnected"].includes(String(event.type))) {
          next.setSessionRunning(key, false);
          // Pi may have created a new session file — link it to the active
          // tab so the sidebar shows it as selected, then refresh.
          client.request<{ sessionFile?: string }>({ type: "get_state" }).then((s) => {
            if (s.sessionFile) {
              const tab = useAppStore.getState().sessions.find((t) => t.id === key);
              if (tab && !tab.sessionPath) {
                useAppStore.getState().updateSessionPath(key, s.sessionFile);
              }
            }
          }).catch(() => {});
          window.dispatchEvent(new CustomEvent("pichamber:session-changed"));
        }
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
    // Ensure loading is cleared even if we skipped the start block.
    state.setSessionLoading(key, false);
    return client;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSessionId]);

  // Auto-start the runtime when the active session changes.
  useEffect(() => {
    const key = state.activeSessionId;
    if (!key) return;
    const session = state.sessions.find((s) => s.id === key);
    if (!session?.sessionPath) return;

    const cwd = session.projectId;
    const existing = state.messages[key];
    if (!existing || existing.length === 0) {
      state.setSessionLoading(key, true);
    }
    let cancelled = false;
    void ensureRuntime(key, cwd, session.sessionPath).catch((error) => {
      if (!cancelled) {
        state.setRuntimeError(error instanceof Error ? error.message : String(error));
        state.setSessionLoading(key, false);
      }
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
    const s = useAppStore.getState();
    s.openPiSession(key, cwd, title, sessionPath);
    if (!s.messages[key]?.length) s.setSessionLoading(key, true);
  }, []);

  const newSession = useCallback(async (cwd: string) => {
    await createSession(cwd).catch(() => {});
    const key = `new:${sessionKey(cwd)}:${Date.now()}`;
    useAppStore.getState().openPiSession(key, cwd, `Session in ${cwd.split("/").pop() ?? cwd}`);
  }, []);

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
    const s = useAppStore.getState();
    const key = s.activeSessionId;
    if (!key) return;
    s.setSessionRunning(key, false);
    getRuntime(key).send({ type: "abort" }).catch(() => {});
  }, []);

  const pickModel = useCallback((model: ModelInfo) => {
    const s = useAppStore.getState();
    s.setSelectedModel(model);
    const key = s.activeSessionId;
    if (key && getRuntime(key).connected) {
      getRuntime(key).request({ type: "set_model", provider: model.provider, modelId: model.id })
        .then(() => getRuntime(key).request<{ thinkingLevel?: ThinkingLevel }>({ type: "get_state" }))
        .then((st) => { if (st?.thinkingLevel) s.setThinkingLevel(st.thinkingLevel); })
        .catch(() => {});
    }
  }, []);

  const setThinking = useCallback((level: ThinkingLevel) => {
    const s = useAppStore.getState();
    s.setThinkingLevel(level);
    const key = s.activeSessionId;
    if (key && getRuntime(key).connected) {
      getRuntime(key).request({ type: "set_thinking_level", level })
        .then(() => getRuntime(key).request<{ thinkingLevel?: ThinkingLevel }>({ type: "get_state" }))
        .then((st) => {
          if (st?.thinkingLevel && st.thinkingLevel !== level) {
            s.setThinkingLevel(st.thinkingLevel);
            toast(`Thinking set to ${st.thinkingLevel} (${level} not available for this model)`);
          }
        })
        .catch(() => {});
    }
  }, []);

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
    const s = useAppStore.getState();
    const key = s.activeSessionId;
    const cwd = key ? s.sessions.find((t) => t.id === key)?.projectId : undefined;
    if (!cwd) return;
    try {
      const file = await workspaceReadFile(cwd, path).catch(() => demoOpenFile(path));
      s.setOpenFile(file);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }, []);

  const attachFile = useCallback(async (): Promise<string | undefined> => {
    const s = useAppStore.getState();
    const key = s.activeSessionId;
    if (!key) return;
    const cwd = s.sessions.find((t) => t.id === key)?.projectId;
    if (!cwd) return;
    const filename = await new Promise<string | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => resolve(input.files?.[0]?.name ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!filename) return;
    s.addAttachment(key, filename);
    return filename;
  }, []);

  const answerUiRequest = useCallback((value: string | boolean | undefined) => {
    const s = useAppStore.getState();
    const request = s.uiRequest;
    const key = s.activeSessionId;
    if (!request || !key) return;
    const payload = value === undefined ? { type: "extension_ui_response" as const, id: request.id, cancelled: true }
      : request.method === "confirm" ? { type: "extension_ui_response" as const, id: request.id, confirmed: value }
      : { type: "extension_ui_response" as const, id: request.id, value };
    getRuntime(key).send(payload);
    s.setUiRequest(undefined);
  }, []);

  const renameSession = useCallback(async () => {
    const s = useAppStore.getState();
    const key = s.activeSessionId;
    if (!key) return;
    const session = s.sessions.find((t) => t.id === key);
    if (!session) return;
    const title = window.prompt("Session name", session.title)?.trim();
    if (!title) return;
    s.renameSession(key, title);
    if (getRuntime(key).connected) getRuntime(key).request({ type: "set_session_name", name: title });
  }, []);

  const renameSessionByPath = useCallback(async (sessionPath: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const s = useAppStore.getState();
    const tab = s.sessions.find((t) => t.sessionPath === sessionPath);
    if (tab) s.renameSession(tab.id, trimmed);
    const key = tab?.id ?? sessionKey(sessionPath);
    if (getRuntime(key).connected) {
      getRuntime(key).request({ type: "set_session_name", name: trimmed }).catch((error) => {
        console.warn("Failed to push session rename to Pi:", error);
      });
    }
  }, []);

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
    const s = useAppStore.getState();
    const key = s.activeSessionId;
    if (!key) return;
    const session = s.sessions.find((t) => t.id === key);
    if (!session) return;
    if (!window.confirm(`Delete “${session.title}”? This cannot be undone.`)) return;
    subscriptions.current.get(key)?.(); subscriptions.current.delete(key);
    await closeRuntime(key);
    if (session.sessionPath) await apiDeleteSession(session.sessionPath).catch((error) => toast.error(String(error)));
    s.closeSession(key);
    s.setRuntimeError(undefined);
  }, []);

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
