import { reactive } from "vue";
import { listSessions, toMessage } from "@/api/client";
import type { SessionInfo } from "@pichamber/shared";
import { ref } from "vue";

export const workspace = reactive({
  // Debug default: the server resolves the active workspace to the user's home.
  // FileTree replaces this marker with the canonical path after its first load.
  cwd: null as string | null,
  sessionId: null as string | null,
  sessionName: null as string | null,
});

export const sessions = ref<SessionInfo[]>([]);
export const sessionsLoading = ref(true);
export const sessionsError = ref<string | null>(null);

export const sessionTitle = (session: SessionInfo | string): string => {
  if (typeof session === "string") {
    const sessionInfo = sessions.value.find(({ id }) => id === session);
    return sessionInfo ? sessionTitle(sessionInfo) : `Session ${session}`;
  }

  return session.name?.trim() || session.firstMessage.trim() || `Session ${session.id}`;
};

export const loadSessions = async () => {
  try {
    sessions.value = await listSessions();
    sessionsError.value = null;
    // 此处无需再调用updateWorkspace，因为 app.vue 里面已经 watch 了
  } catch (error) {
    sessionsError.value = toMessage(error);
  } finally {
    sessionsLoading.value = false;
  }
};

export const updateWorkspace = (sessionId: string) => {
  workspace.sessionId = sessionId;
  const session = sessions.value.find(({ id }) => id === sessionId);
  workspace.sessionName = sessionTitle(session ?? sessionId);
  workspace.cwd = session?.cwd ?? "~";
  console.log("[workspace] updated", workspace);
};
