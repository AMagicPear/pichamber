import { reactive, ref } from "vue";
import { getEntries, listSessions, toMessage } from "@/api/client";
import type { ConversationMessage, SessionInfo } from "@pichamber/shared";

export const workspace = reactive({
  cwd: "~" as string | null,
  folderName: null as string | null,
  sessionId: null as string | null,
  sessionName: "New Session" as string | null,
});

export const sessions = ref<SessionInfo[]>([]);
export const entries = ref<ConversationMessage[]>([]);
export const sessionsLoading = ref(false);
export const sessionsError = ref<string | null>(null);
// sessionsLoadPromise 用于防止重复加载会话列表
// 比如说，当直接访问后面带一个 session ID 的 URL 时，App.vue 会在 mounted 时调用 updateWorkspace，
// 而 SessionSidebar.vue 也会在 mounted 时调用 loadSessions，这样就会导致重复加载会话列表
let sessionsLoadPromise: Promise<void> | null = null;

// 这个功能是传入一个会话，获取会话的标题
// 假如传入的是一个 ID，它就会先找这个会话的信息
// 如果直接传入会话的信息，就直接从里面读名称字段或者第一条消息
export const sessionTitle = (session: SessionInfo | string): string => {
  const sessionInfo =
    typeof session === "string" ? sessions.value.find(({ id }) => id === session) : session;
  const sessionId = typeof session === "string" ? session : session.id;

  return sessionInfo?.name?.trim() || sessionInfo?.firstMessage.trim() || `Session ${sessionId}`;
};

export const loadSessions = () => {
  if (sessionsLoadPromise) return sessionsLoadPromise;

  sessionsLoading.value = true;
  sessionsLoadPromise = (async () => {
    try {
      sessions.value = await listSessions();
      sessionsError.value = null;
      console.log("[workspace] loaded sessions of num:", sessions.value.length);
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

export const updateWorkspace = async (sessionId: string) => {
  workspace.sessionId = sessionId;
  const [, sessionEntries] = await Promise.all([loadSessions(), getEntries(sessionId)]);
  if (workspace.sessionId !== sessionId) return;

  const session = sessions.value.find(({ id }) => id === sessionId);
  workspace.sessionName = sessionTitle(session ?? sessionId);
  workspace.folderName = session?.cwd?.split("/")?.pop() ?? null;
  workspace.cwd = session?.cwd ?? null;
  entries.value = sessionEntries;
  console.log("[workspace] updated", workspace);
};
