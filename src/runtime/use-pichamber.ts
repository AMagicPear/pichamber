import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { closeRuntime, getRuntime } from "./registry";
import { normalizeBackendMessages } from "./normalize";
import { deleteSession as apiDeleteSession, workspaceReadFile, createSession } from "../api/client";
import type { ModelInfo, OpenFile, ThinkingLevel } from "./types";
import { useAppStore } from "../stores/app-store";

// ── Helpers ──────────────────────────────────────────────────────────

function sessionKey(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  return `pi:${Math.abs(hash).toString(36)}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Hook ─────────────────────────────────────────────────────────────

export function usePichamber() {
  const store = useAppStore;
  const subscriptions = useRef(new Map<string, () => void>());

  useEffect(() => () => {
    subscriptions.current.forEach((unsub) => unsub());
  }, []);

  // ── Runtime lifecycle ──────────────────────────────────────────────

  /** Start or reconnect the runtime for a session. Always clears loading. */
  const ensureRuntime = useCallback(async (key: string, cwd: string, sessionPath?: string) => {
    const client = getRuntime(key);

    // Subscribe to events once per session lifetime.
    if (!subscriptions.current.has(key)) {
      subscriptions.current.set(key, client.onEvent((event) => {
        const s = store.getState();
        s.reduceRuntimeEvent(key, event);

        if (event.type === "agent_start") s.setSessionRunning(key, true);

        if (event.type === "agent_end" || event.type === "rpc_disconnected") {
          s.setSessionRunning(key, false);
          if (event.type === "agent_end") onAgentEnd(key, client);
        }

        if (event.type === "extension_ui_request" && event.method === "notify") {
          toast(String(event.message ?? event.title ?? "Pi notification"));
        }
      }));
    }

    // First connection: start Pi, load history, fetch models.
    if (!client.connected) {
      await client.start(cwd);
      if (sessionPath) {
        await client.request({ type: "switch_session", sessionPath });
        const { messages } = await client.request<{ messages: unknown[] }>({ type: "get_messages" });
        store.getState().hydrateMessages(key, normalizeBackendMessages(messages ?? []));
      }
      const { models } = await client.request<{ models: ModelInfo[] }>({ type: "get_available_models" }).catch(() => ({ models: [] as ModelInfo[] }));
      if (models.length) store.getState().setModels(models);

      if (sessionPath) {
        const sessionState = await client.request<{
          model?: { provider: string; id: string };
          thinkingLevel?: ThinkingLevel;
        }>({ type: "get_state" }).catch(() => ({} as Record<string, never>));
        if (sessionState.thinkingLevel) store.getState().setThinkingLevel(sessionState.thinkingLevel);
        if (sessionState.model?.id) {
          const found = models.find((m) => m.id === sessionState.model!.id);
          if (found) store.getState().setSelectedModel(found);
        }
      }
    }

    store.getState().setSessionLoading(key, false);
    return client;
  }, []);

  /** After Pi finishes a turn, link the session file and refresh sidebar. */
  function onAgentEnd(key: string, client: ReturnType<typeof getRuntime>) {
    client.request<{ sessionFile?: string }>({ type: "get_state" }).then((s) => {
      if (s.sessionFile) {
        const tab = store.getState().sessions.find((t) => t.id === key);
        if (tab && !tab.sessionPath) {
          store.getState().updateSessionPath(key, s.sessionFile);
        }
      }
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent("pichamber:session-changed"));
  }

  // ── Session actions ────────────────────────────────────────────────

  const openSession = useCallback((sessionPath: string, cwd: string, title: string) => {
    const key = sessionKey(sessionPath);
    const s = store.getState();
    s.openPiSession(key, cwd, title, sessionPath);
    if (!s.messages[key]?.length) s.setSessionLoading(key, true);
  }, []);

  const newSession = useCallback(async (cwd: string) => {
    await createSession(cwd).catch(() => {});
    const key = `new:${sessionKey(cwd)}:${Date.now()}`;
    store.getState().openPiSession(key, cwd, `Session in ${cwd.split("/").pop() ?? cwd}`);
  }, []);

  const sendPrompt = useCallback(async (text: string) => {
    const s = store.getState();
    const key = s.activeSessionId;
    if (!key) return;
    const session = s.sessions.find((t) => t.id === key);
    if (!session?.projectId) return;

    const attachments = s.attachments[key] ?? [];
    const msg = attachments.length > 0
      ? `${text}\n\n${attachments.map((p) => `@${p}`).join("\n")}`
      : text;

    s.addUserMessage(key, msg, attachments);
    s.removeAllAttachments(key);
    s.setRuntimeError(undefined);

    try {
      const client = await ensureRuntime(key, session.projectId, session.sessionPath);
      s.setSessionRunning(key, true);
      await client.request({ type: "prompt", message: msg, streamingBehavior: "followUp" });
    } catch (err) {
      s.setSessionRunning(key, false);
      s.setRuntimeError(errorMessage(err));
    }
  }, [ensureRuntime]);

  const stopPrompt = useCallback(() => {
    const key = store.getState().activeSessionId;
    if (!key) return;
    store.getState().setSessionRunning(key, false);
    getRuntime(key).send({ type: "abort" }).catch(() => {});
  }, []);

  // ── Model / thinking ───────────────────────────────────────────────

  const pickModel = useCallback((model: ModelInfo) => {
    const s = store.getState();
    s.setSelectedModel(model);
    const key = s.activeSessionId;
    if (!key || !getRuntime(key).connected) return;
    getRuntime(key).request({ type: "set_model", provider: model.provider, modelId: model.id })
      .then(() => getRuntime(key).request<{ thinkingLevel?: ThinkingLevel }>({ type: "get_state" }))
      .then((st) => { if (st?.thinkingLevel) s.setThinkingLevel(st.thinkingLevel); })
      .catch(() => {});
  }, []);

  const setThinking = useCallback((level: ThinkingLevel) => {
    const s = store.getState();
    s.setThinkingLevel(level);
    const key = s.activeSessionId;
    if (!key || !getRuntime(key).connected) return;
    getRuntime(key).request({ type: "set_thinking_level", level })
      .then(() => getRuntime(key).request<{ thinkingLevel?: ThinkingLevel }>({ type: "get_state" }))
      .then((st) => {
        if (st?.thinkingLevel && st.thinkingLevel !== level) {
          s.setThinkingLevel(st.thinkingLevel);
          toast(`Thinking set to ${st.thinkingLevel} (${level} not available for this model)`);
        }
      })
      .catch(() => {});
  }, []);

  // ── Session operations ─────────────────────────────────────────────

  const regeneratePrompt = useCallback(async () => {
    const s = store.getState();
    const key = s.activeSessionId;
    if (!key) return;
    const msgs = s.messages[key] ?? [];
    const lastUser = msgs.findLast((m) => m.role === "user");
    if (!lastUser) { toast.error("Nothing to regenerate"); return; }
    await sendPrompt(lastUser.text);
  }, [sendPrompt]);

  const forkSession = useCallback(async () => {
    const s = store.getState();
    const key = s.activeSessionId;
    const session = key ? s.sessions.find((t) => t.id === key) : undefined;
    if (!session?.projectId) return;
    try {
      const client = await ensureRuntime(key, session.projectId, session.sessionPath);
      const data = await client.request<{ messages?: Array<{ id?: string; entryId?: string }> }>({ type: "get_fork_messages" });
      const last = data.messages?.at(-1);
      const entryId = last?.entryId ?? last?.id;
      if (!entryId) throw new Error("This session does not have a forkable turn yet");
      await client.request({ type: "fork", entryId });
      const { messages } = await client.request<{ messages: unknown[] }>({ type: "get_messages" });
      s.hydrateMessages(key, normalizeBackendMessages(messages ?? []));
      s.renameSession(key, `${session.title} (fork)`);
      toast.success("Forked from the latest turn");
    } catch (err) { toast.error(errorMessage(err)); }
  }, [ensureRuntime]);

  const deleteSession = useCallback(async () => {
    const s = store.getState();
    const key = s.activeSessionId;
    const session = key ? s.sessions.find((t) => t.id === key) : undefined;
    if (!session) return;
    if (!window.confirm(`Delete "${session.title}"? This cannot be undone.`)) return;
    subscriptions.current.get(key)?.();
    subscriptions.current.delete(key);
    await closeRuntime(key);
    if (session.sessionPath) await apiDeleteSession(session.sessionPath).catch((e) => toast.error(String(e)));
    s.closeSession(key);
    s.setRuntimeError(undefined);
  }, []);

  // ── Files & attachments ────────────────────────────────────────────

  const openFile = useCallback(async (path: string) => {
    const key = store.getState().activeSessionId;
    const cwd = key ? store.getState().sessions.find((t) => t.id === key)?.projectId : undefined;
    if (!cwd) return;
    try {
      const file = await workspaceReadFile(cwd, path);
      store.getState().setOpenFile(file);
    } catch (err) { toast.error(errorMessage(err)); }
  }, []);

  const attachFile = useCallback(async (): Promise<string | undefined> => {
    const s = store.getState();
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

  // ── Renames ────────────────────────────────────────────────────────

  const renameSession = useCallback(async () => {
    const s = store.getState();
    const key = s.activeSessionId;
    const session = key ? s.sessions.find((t) => t.id === key) : undefined;
    if (!session) return;
    const title = window.prompt("Session name", session.title)?.trim();
    if (!title) return;
    s.renameSession(key, title);
    if (getRuntime(key).connected) getRuntime(key).request({ type: "set_session_name", name: title });
  }, []);

  const renameSessionByPath = useCallback(async (sessionPath: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const s = store.getState();
    const tab = s.sessions.find((t) => t.sessionPath === sessionPath);
    if (tab) s.renameSession(tab.id, trimmed);
    const key = tab?.id ?? sessionKey(sessionPath);
    if (getRuntime(key).connected) {
      getRuntime(key).request({ type: "set_session_name", name: trimmed }).catch((e) => {
        console.warn("Failed to push session rename to Pi:", e);
      });
    }
  }, []);

  // ── Misc ───────────────────────────────────────────────────────────

  const answerUiRequest = useCallback((value: string | boolean | undefined) => {
    const s = store.getState();
    const request = s.uiRequest;
    const key = s.activeSessionId;
    if (!request || !key) return;
    const payload = value === undefined
      ? { type: "extension_ui_response" as const, id: request.id, cancelled: true }
      : request.method === "confirm"
        ? { type: "extension_ui_response" as const, id: request.id, confirmed: value }
        : { type: "extension_ui_response" as const, id: request.id, value };
    getRuntime(key).send(payload);
    s.setUiRequest(undefined);
  }, []);

  return {
    openSession, newSession, sendPrompt, regeneratePrompt, stopPrompt,
    pickModel, setThinking, openFile, attachFile, answerUiRequest,
    renameSession, renameSessionByPath, forkSession, deleteSession,
  };
}
