// ─────────────────────────────────────────────────────────────────────────────
// Bridges UI actions to Pi RPC commands. Subscribes to the active session's
// RpcClient and folds events into the SessionView stored in zustand. Pi owns
// the source of truth for messages, state, and tool calls; pichamber just
// mirrors.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";
import { toast } from "sonner";
import { closeRuntime, getRuntime } from "./registry";
import { applyEvent, initialView } from "./events";
import {
  deleteSession as apiDeleteSession,
  listAllSessionsGrouped,
  workspaceReadFile,
} from "../api/client";
import type { AgentMessage, Model, RpcSessionState, ThinkingLevel } from "./types";
import { useAppStore } from "../stores/app-store";

const SESSION_PREFIX = "pi:";

/** Stable id derived from a session file path. Pi encodes the session id in
 *  the filename (`<timestamp>_<id>.jsonl`); we just extract it. */
export function keyFromSessionPath(path: string): string {
  const file = path.split("/").pop() ?? path;
  const stem = file.endsWith(".jsonl") ? file.slice(0, -6) : file;
  const underscore = stem.lastIndexOf("_");
  return SESSION_PREFIX + (underscore > 0 ? stem.slice(underscore + 1) : path);
}

export function usePichamber() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  // Read only what we need from sessions to avoid unstable object references.
  const activeProjectId = useAppStore((s) => {
    const session = s.sessions.find((t) => t.id === s.activeSessionId);
    return session?.projectId ?? null;
  });
  const activeSessionPath = useAppStore((s) => {
    const session = s.sessions.find((t) => t.id === s.activeSessionId);
    return session?.sessionPath;
  });

  // ─── Subscribe to Pi events for the active session ────────────────────
  useEffect(() => {
    if (!activeSessionId) return;
    const client = getRuntime(activeSessionId);
    const unsub = client.onEvent((event) => {
      const store = useAppStore.getState();
      const prev = store.view;
      const next = applyEvent(prev, event);
      store.setView(next);

      // Surface the events Pi emits that aren't represented in SessionView.
      if (event.type === "extension_ui_request") {
        const req = event as { method?: string; message?: string; title?: string; notifyType?: string };
        if (req.method === "notify") {
          toast[req.notifyType === "error" ? "error" : req.notifyType === "warning" ? "warning" : "info"](
            String(req.message ?? req.title ?? "Pi notification"),
          );
        }
      }
      if (event.type === "error" || event.type === "extension_error") {
        toast.error(String((event as { error?: string }).error ?? "Pi runtime error"));
      }
      // Sidebar refresh on disk-side changes.
      if (event.type === "entry_appended" || event.type === "session_info_changed" || event.type === "agent_end") {
        listAllSessionsGrouped().then((groups) => useAppStore.getState().setSessionGroups(groups)).catch(() => undefined);
      }
    });
    return () => { unsub(); };
  }, [activeSessionId]);

  // ─── Connect + load history when the active session changes ───────────
  useEffect(() => {
    if (!activeSessionId || !activeProjectId) return;
    const sessionId = activeSessionId; // capture stable snapshot
    const client = getRuntime(sessionId);
    const cwd = activeProjectId;
    const sessionPath = activeSessionPath;
    let cancelled = false;

    useAppStore.getState().setSessionLoading(true);
    useAppStore.getState().setError(undefined);
    useAppStore.getState().setView(initialView());

    (async () => {
      try {
        await client.start(cwd, useAppStore.getState().piPath || undefined);
        if (cancelled) return;

        // Fetch models once per app lifetime, using the first session's Pi
        // process (which has the correct cwd for provider config).
        if (!useAppStore.getState().models.length && !useAppStore.getState().modelsError) {
          const data = await client.request<{ models: Model[] }>({ type: "get_available_models" }).catch(() => ({ models: [] as Model[] }));
          if (!cancelled && data.models.length) {
            useAppStore.getState().setModels(data.models);
          } else if (!cancelled) {
            useAppStore.getState().setModelsError("Could not load models from Pi");
          }
        }

        if (sessionPath) {
          await client.request({ type: "switch_session", sessionPath });
          if (cancelled) return;

          const history = await client.request<{ messages: AgentMessage[] }>({ type: "get_messages" });
          if (cancelled) return;
          // Dedup by role + timestamp: forked sessions may carry duplicate
          // toolResult entries from Pi's branch copy process.
          const deduped = (history.messages ?? []).filter(
            (m, i, arr) =>
              i ===
              arr.findIndex(
                (m2) => m2.role === m.role && (m2 as { timestamp: number }).timestamp === (m as { timestamp: number }).timestamp,
              ),
          );
          useAppStore.getState().setView((prev) => ({ ...prev, messages: deduped }));

          // get_state returns data: RpcSessionState directly
          const sessionState = await client.request<RpcSessionState>({ type: "get_state" }).catch(() => null);
          if (cancelled) return;
          if (sessionState) {
            useAppStore.getState().mergeViewState(sessionState);
          }
        }
      } catch (error) {
        if (!cancelled) useAppStore.getState().setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) useAppStore.getState().setSessionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSessionId, activeProjectId, activeSessionPath]);

  // ─── Actions (UI intent → Pi RPC) ─────────────────────────────────────
  const sendPrompt = (text: string, images?: unknown[], behavior: "steer" | "followUp" = "followUp") => {
    if (!activeSessionId) return Promise.resolve();
    return getRuntime(activeSessionId).request({ type: "prompt", message: text, images, streamingBehavior: behavior });
  };

  const stopPrompt = () => { if (activeSessionId) getRuntime(activeSessionId).send({ type: "abort" }); };

  const pickModel = (model: Model) => {
    useAppStore.getState().setSelectedModel(model);
    if (activeSessionId) {
      // set_model response includes the confirmed Model from Pi
      getRuntime(activeSessionId)
        .request<Model>({ type: "set_model", provider: model.provider, modelId: model.id })
        .then((confirmed) => useAppStore.getState().setSelectedModel(confirmed))
        .catch(() => undefined);
    }
  };

  const setThinking = (level: ThinkingLevel) => {
    useAppStore.getState().setThinkingLevel(level);
    if (activeSessionId) getRuntime(activeSessionId).request({ type: "set_thinking_level", level }).catch(() => undefined);
  };

  const renameActive = () => {
    if (!activeSessionId) return;
    const session = useAppStore.getState().sessions.find((t) => t.id === activeSessionId);
    if (!session) return;
    const title = window.prompt("Session name", session.title)?.trim();
    if (!title) return;
    useAppStore.getState().upsertSession({ ...session, title });
    if (getRuntime(activeSessionId).connected) getRuntime(activeSessionId).request({ type: "set_session_name", name: title });
  };

  const renameByPath = (sessionPath: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    const tab = useAppStore.getState().sessions.find((t) => t.sessionPath === sessionPath);
    if (tab) useAppStore.getState().upsertSession({ ...tab, title: trimmed });
    const key = tab?.id ?? keyFromSessionPath(sessionPath);
    if (getRuntime(key).connected) getRuntime(key).request({ type: "set_session_name", name: trimmed }).catch(() => undefined);
  };

  const deleteActive = async () => {
    if (!activeSessionId) return;
    const session = useAppStore.getState().sessions.find((t) => t.id === activeSessionId);
    if (!session) return;
    if (!window.confirm(`Delete "${session.title}"? This cannot be undone.`)) return;
    await closeRuntime(activeSessionId);
    if (session.sessionPath) await apiDeleteSession(session.sessionPath).catch((e) => toast.error(String(e)));
    useAppStore.getState().closeSession(activeSessionId);
  };

  /** Create a new session using Pi's `new_session` RPC. */
  const newSession = async (cwd: string) => {
    // Use a temporary client to call new_session via Pi RPC.
    const tempKey = `${SESSION_PREFIX}new:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const client = getRuntime(tempKey);
    try {
      await client.start(cwd, useAppStore.getState().piPath || undefined);

      // Pi creates the .jsonl file and returns whether it was cancelled.
      const result = await client.request<{ cancelled: boolean }>({ type: "new_session" });
      if (result.cancelled) {
        await closeRuntime(tempKey);
        return;
      }

      // Get the session metadata (sessionFile path, sessionId, sessionName).
      const state = await client.request<RpcSessionState>({ type: "get_state" });
      const sessionPath = state.sessionFile;
      const sessionId = sessionPath ? keyFromSessionPath(sessionPath) : tempKey;

      // Clean up the temporary client.
      await closeRuntime(tempKey);

      useAppStore.getState().upsertSession({
        id: sessionId,
        projectId: cwd,
        title: state.sessionName || `Session ${state.sessionId.slice(0, 8)}`,
        sessionPath,
        running: false,
        unread: false,
      });

      // Refresh sidebar to show the new session.
      listAllSessionsGrouped().then((groups) => useAppStore.getState().setSessionGroups(groups)).catch(() => undefined);
    } catch (error) {
      await closeRuntime(tempKey).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "Failed to create session");
    }
  };

  const openSession = (sessionPath: string, cwd: string, title: string) => {
    const id = keyFromSessionPath(sessionPath);
    useAppStore.getState().upsertSession({
      id,
      projectId: cwd,
      title: title || sessionPath.split("/").pop()?.replace(/\.jsonl$/, "") || "Session",
      sessionPath,
      running: false,
      unread: false,
    });
  };

  const openFile = async (path: string) => {
    const cwd = useAppStore.getState().activeProjectId;
    if (!cwd) return;
    try {
      const file = await workspaceReadFile(cwd, path);
      useAppStore.getState().setOpenFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const answerUiRequest = (value: string | boolean | undefined) => {
    const s = useAppStore.getState();
    const request = s.uiRequest;
    if (!request || !activeSessionId) return;
    let payload: Record<string, unknown>;
    if (value === undefined) payload = { type: "extension_ui_response", id: request.id, cancelled: true };
    else if (request.method === "confirm") payload = { type: "extension_ui_response", id: request.id, confirmed: value };
    else payload = { type: "extension_ui_response", id: request.id, value };
    getRuntime(activeSessionId).send(payload);
    s.setUiRequest(undefined);
  };

  return {
    sendPrompt,
    stopPrompt,
    pickModel,
    setThinking,
    renameSession: renameActive,
    renameSessionByPath: renameByPath,
    deleteSession: deleteActive,
    newSession,
    openSession,
    openFile,
    answerUiRequest,
  };
}
