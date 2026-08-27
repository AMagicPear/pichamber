import { reactive, ref } from "vue";
import { copySession, createSession, forkSession, listSessions, renameSession, toMessage } from "@/api/client";
import { pathBasename } from "@amagicpear/pichamber-shared";
import type { SessionInfo } from "@amagicpear/pichamber-shared";
import { i18n } from "@/i18n";

/** Project and selected-session metadata. Runtime session state belongs in
 * `@/stores/session`; this module intentionally knows nothing about WS frames. */
export const workspace = reactive({
  cwd: "~" as string | null,
  folderName: null as string | null,
  sessionId: null as string | null,
  sessionName: i18n.global.t("sidebar.newSessionLabel") as string | null,
});

export const sessions = ref<SessionInfo[]>([]);
export const sessionsLoading = ref(false);
export const sessionsError = ref<string | null>(null);
let sessionsLoadPromise: Promise<void> | null = null;

export const sessionTitle = (session: SessionInfo | string) => {
  const info = typeof session === "string" ? sessions.value.find(({ id }) => id === session) : session;
  const id = typeof session === "string" ? session : session.id;
  return info?.name?.trim()
    || info?.firstMessage?.trim()
    || (info?.messageCount === 0
      ? i18n.global.t("sidebar.newSessionLabel")
      : i18n.global.t("sidebar.sessionFallback", { id }));
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
      sessionsLoadPromise = null;
    } finally {
      sessionsLoading.value = false;
    }
  })();
  return sessionsLoadPromise;
};

const syncWorkspaceMetadata = (sessionId: string) => {
  const session = sessions.value.find(({ id }) => id === sessionId);
  if (!session || workspace.sessionId !== sessionId) return false;
  workspace.sessionName = sessionTitle(session);
  workspace.folderName = session.cwd ? pathBasename(session.cwd) : null;
  workspace.cwd = session.cwd || null;
  return true;
};

let sessionsRefreshPromise: Promise<void> | null = null;
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
  })().finally(() => { sessionsRefreshPromise = null; });
  return sessionsRefreshPromise;
};

export const renameSessionInStore = async (sessionId: string, name: string) => {
  const trimmed = name.trim();
  await renameSession(sessionId, trimmed);
  sessions.value = sessions.value.map((session) => session.id === sessionId ? { ...session, name: trimmed } : session);
  if (workspace.sessionId === sessionId) workspace.sessionName = trimmed;
  return trimmed;
};

export const createSessionForCwd = async (cwd: string) => {
  const { sessionId, cwd: resolvedCwd } = await createSession(cwd);
  workspace.sessionId = sessionId;
  workspace.cwd = resolvedCwd;
  workspace.folderName = pathBasename(resolvedCwd);
  workspace.sessionName = i18n.global.t("sidebar.newSessionLabel");
  return sessionId;
};

export const forkSessionFromEntry = async (sessionId: string, entryId: string) => {
  const fork = await forkSession(sessionId, entryId);
  workspace.sessionId = fork.sessionId;
  workspace.cwd = fork.cwd;
  workspace.folderName = pathBasename(fork.cwd);
  workspace.sessionName = i18n.global.t("sidebar.newSessionLabel");
  void refreshSessions();
  return fork.sessionId;
};

export const copySessionToProject = async (sessionId: string, cwd: string) => {
  const copy = await copySession(sessionId, cwd);
  await refreshSessions();
  return copy;
};

export const updateWorkspace = async (sessionId: string) => {
  if (workspace.sessionId === sessionId && workspace.cwd !== null) return true;
  await loadSessions();
  if (sessionsError.value || !sessions.value.some((session) => session.id === sessionId)) return false;
  workspace.sessionId = sessionId;
  if (syncWorkspaceMetadata(sessionId)) return true;
  await refreshSessions();
  return sessionsError.value ? true : syncWorkspaceMetadata(sessionId);
};
