import { reactive, ref } from "vue";
import { createSession, listSessions, toMessage } from "@/api/client";
import { pathBasename } from "@amagicpear/pichamber-shared";
import type { ModelDescriptor, SessionInfo } from "@amagicpear/pichamber-shared";

export const workspace = reactive({
  cwd: "~" as string | null,
  folderName: null as string | null,
  sessionId: null as string | null,
  sessionName: "New Session" as string | null,
  /** Active model mirror so views outside the conversation panel (header)
   *  can read the same provider/model the input area is bound to. Owned
   *  by `useConversationSession`: it writes on every snapshot/state push
   *  and clears on disconnect. */
  currentModel: undefined as ModelDescriptor | undefined,
});

export const sessions = ref<SessionInfo[]>([]);
export const sessionsLoading = ref(false);
export const sessionsError = ref<string | null>(null);
// sessionsLoadPromise 用于防止重复加载会话列表
// 直接访问 session URL 时路由守卫和侧栏都需要会话列表，复用同一请求。
let sessionsLoadPromise: Promise<void> | null = null;

// 这个功能是传入一个会话，获取会话的标题
// 假如传入的是一个 ID，它就会先找这个会话的信息
// 如果直接传入会话的信息，就直接从里面读名称字段或者第一条消息
export const sessionTitle = (session: SessionInfo | string): string => {
  const sessionInfo =
    typeof session === "string" ? sessions.value.find(({ id }) => id === session) : session;
  const sessionId = typeof session === "string" ? session : session.id;

  return (
    sessionInfo?.name?.trim() ||
    sessionInfo?.firstMessage?.trim() ||
    (sessionInfo?.messageCount === 0 ? "New Session" : `Session ${sessionId}`)
  );
};

export const loadSessions = () => {
  if (sessionsLoadPromise) return sessionsLoadPromise;

  sessionsLoading.value = true;
  sessionsLoadPromise = (async () => {
    try {
      sessions.value = await listSessions();
      sessionsError.value = null;
    } catch (error) {
      sessionsError.value = toMessage(error);
      // 失败后清空缓存，允许后续调用重新加载
      sessionsLoadPromise = null;
    } finally {
      sessionsLoading.value = false;
    }
  })();

  return sessionsLoadPromise;
};

const syncWorkspaceMetadata = (sessionId: string): boolean => {
  const session = sessions.value.find(({ id }) => id === sessionId);
  if (!session || workspace.sessionId !== sessionId) return false;
  workspace.sessionName = sessionTitle(session);
  workspace.folderName = session.cwd ? pathBasename(session.cwd) : null;
  workspace.cwd = session.cwd || null;
  return true;
};

let sessionsRefreshPromise: Promise<void> | null = null;

/** Refresh the server snapshot without replacing the visible list with a loading state. */
export const refreshSessions = () => {
  if (sessionsRefreshPromise) return sessionsRefreshPromise;

  sessionsRefreshPromise = (async () => {
    if (sessionsLoadPromise) await sessionsLoadPromise;
    try {
      sessions.value = await listSessions();
      sessionsError.value = null;
      if (workspace.sessionId) syncWorkspaceMetadata(workspace.sessionId);
    } catch (error) {
      sessionsError.value = toMessage(error);
    }
  })().finally(() => {
    sessionsRefreshPromise = null;
  });

  return sessionsRefreshPromise;
};

export const createSessionForCwd = async (cwd: string) => {
  const { sessionId, cwd: resolvedCwd } = await createSession(cwd);
  workspace.sessionId = sessionId;
  workspace.cwd = resolvedCwd;
  workspace.folderName = pathBasename(resolvedCwd);
  workspace.sessionName = "New Session";
  return sessionId;
};

export const updateWorkspace = async (sessionId: string) => {
  // A freshly created empty session is active in memory before Pi persists it,
  // so it may not appear in listAll() yet. Its local metadata is authoritative.
  if (workspace.sessionId === sessionId && workspace.cwd !== null) return true;
  workspace.sessionId = sessionId;
  await loadSessions();
  if (workspace.sessionId !== sessionId) return false;
  if (sessionsError.value) return true;
  if (syncWorkspaceMetadata(sessionId)) return true;
  await refreshSessions();
  return sessionsError.value ? true : syncWorkspaceMetadata(sessionId);
};
