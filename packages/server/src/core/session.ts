/**
 * Pichamber's session registry. The registry owns the Pi execution mode and
 * lifecycle; providers, extensions, and quota services stay outside it.
 * 注意：pi的行为是，创建新的 session 时，默认不创建本地文件，要等有了对话更新之后才会创建。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import {
  type CreateAgentSessionRuntimeFactory,
  type SessionInfo,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { toMessage } from "../error";
import { getRuntimeMode, loadAppConfig, setRuntimeMode } from "../settings/app-config";
import {
  RpcSessionDriver,
  SdkSessionDriver,
  type SessionDriver,
  type SessionDriverMode,
} from "./driver";

const sessionFileLookup = new Map<string, string>();
const activeSessions = new Map<string, SessionDriver>();
const openingSessions = new Map<string, Promise<SessionDriver | null>>();
let runtimeTransition: Promise<void> | null = null;

const sessionIdentity = (sessionManager: SessionManager) => {
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) throw new Error("Pi did not create a session file");
  return {
    id: sessionManager.getSessionId(),
    sessionFile,
    cwd: sessionManager.getCwd(),
  };
};

const registerDriver = <T extends SessionDriver>(driver: T): T => {
  activeSessions.set(driver.sessionId, driver);
  sessionFileLookup.set(driver.sessionId, driver.sessionFile);
  return driver;
};

const takeActiveDriver = (id: string) => {
  const driver = activeSessions.get(id);
  if (driver) activeSessions.delete(id);
  return driver;
};

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  agentDir,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd, agentDir });
  const result = await createAgentSessionFromServices({
    services,
    sessionManager,
    sessionStartEvent,
  });
  return { ...result, services, diagnostics: services.diagnostics };
};

export const createSdkDriver = (sessionManager: SessionManager) => {
  const { id, sessionFile, cwd } = sessionIdentity(sessionManager);
  return new SdkSessionDriver(id, sessionFile, cwd, () =>
    createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    }),
  );
};

const createDriver = (sessionManager: SessionManager, mode: SessionDriverMode): SessionDriver => {
  if (mode === "sdk") return createSdkDriver(sessionManager);
  const { id, sessionFile, cwd } = sessionIdentity(sessionManager);
  return new RpcSessionDriver({ sessionId: id, sessionFile, cwd });
};

const createNewDriver = (sessionManager: SessionManager, mode: SessionDriverMode) => {
  if (mode === "sdk") return createSdkDriver(sessionManager);
  return new RpcSessionDriver({
    sessionId: sessionManager.getSessionId(),
    cwd: sessionManager.getCwd(),
  });
};

const getSessionFileWithId = async (id: string): Promise<string | null> => {
  let sessionFile = sessionFileLookup.get(id);
  if (!sessionFile) {
    await listAllSessions();
    sessionFile = sessionFileLookup.get(id);
  }
  return sessionFile ?? null;
};

export const listAllSessions = async (): Promise<SessionInfo[]> => {
  const sessions = await SessionManager.listAll();
  sessionFileLookup.clear();
  for (const session of sessions) sessionFileLookup.set(session.id, session.path);
  return sessions;
};

/** Activate a session once. Concurrent callers share the same driver open. */
export const getSessionDriver = async (id: string): Promise<SessionDriver | null> => {
  await loadAppConfig();
  if (runtimeTransition) await runtimeTransition;
  const cached = activeSessions.get(id);
  if (cached) return cached;
  const opening = openingSessions.get(id);
  if (opening) return opening;

  const open = (async () => {
    const sessionFile = await getSessionFileWithId(id);
    if (!sessionFile) return null;
    const driver = createDriver(SessionManager.open(sessionFile), getRuntimeMode());
    await driver.start();
    return registerDriver(driver);
  })();
  openingSessions.set(id, open);
  try {
    return await open;
  } finally {
    openingSessions.delete(id);
  }
};

export { getRuntimeMode } from "../settings/app-config";

export const getSessionCwd = async (id: string): Promise<string | null> => {
  const active = activeSessions.get(id);
  if (active) return active.cwd;
  const sessionFile = await getSessionFileWithId(id);
  return sessionFile ? SessionManager.open(sessionFile).getCwd() : null;
};

export const deactivateSession = async (id: string) => {
  const driver = takeActiveDriver(id);
  if (!driver) return;
  await driver.dispose();
};

export const deleteSession = async (
  id: string,
): Promise<{ ok: boolean; method: "trash" | "unlink" | "inmemory"; error?: string }> => {
  const driver = takeActiveDriver(id);
  if (driver) await driver.dispose();
  const sessionPath = driver?.sessionFile ?? sessionFileLookup.get(id);
  if (!sessionPath) {
    sessionFileLookup.delete(id);
    return { ok: true, method: "inmemory" };
  }
  const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
  const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });
  if (trashResult.status === 0 || !existsSync(sessionPath)) {
    sessionFileLookup.delete(id);
    return { ok: true, method: "trash" };
  }
  try {
    await unlink(sessionPath);
    sessionFileLookup.delete(id);
    return { ok: true, method: "unlink" };
  } catch (err) {
    const stderr = trashResult.stderr?.trim();
    const hint = stderr ? ` (trash: ${stderr.split("\n")[0]})` : "";
    return { ok: false, method: "unlink", error: `${toMessage(err)}${hint}` };
  }
};

export const renameSession = async (id: string, name: string): Promise<boolean> => {
  const driver = activeSessions.get(id);
  if (driver instanceof SdkSessionDriver) {
    driver.session.sessionManager.appendSessionInfo(name);
    return true;
  }
  const sessionFile = await getSessionFileWithId(id);
  if (!sessionFile) return false;
  SessionManager.open(sessionFile).appendSessionInfo(name);
  return true;
};

export const createSessionWithCwd = async (cwd: string): Promise<SessionDriver> => {
  await loadAppConfig();
  if (runtimeTransition) await runtimeTransition;
  const driver = createNewDriver(SessionManager.create(cwd), getRuntimeMode());
  await driver.start();
  return registerDriver(driver);
};

export const switchRuntimeMode = async (
  mode: SessionDriverMode,
  closeChannel: (sessionId: string) => Promise<void>,
) => {
  await loadAppConfig();
  if (runtimeTransition) await runtimeTransition;
  if (mode === getRuntimeMode()) return;

  const sessions = [...activeSessions.entries()];
  const drivers = sessions.map(([, driver]) => driver);
  const transition = (async () => {
    await Promise.all(drivers.map((driver) => driver.abort().catch(() => undefined)));
    await Promise.all(sessions.map(([sessionId]) => closeChannel(sessionId)));
    activeSessions.clear();
    await Promise.all(drivers.map((driver) => driver.dispose()));
    await setRuntimeMode(mode);
  })();
  runtimeTransition = transition;
  try {
    await transition;
  } finally {
    runtimeTransition = null;
  }
};
