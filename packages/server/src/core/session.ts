/**
 * Pichamber's session registry. The registry owns the Pi execution mode and
 * lifecycle; providers, extensions, and quota services stay outside it.
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
import { RpcSessionDriver, SdkSessionDriver, type SessionDriver, type SessionDriverMode } from "./driver";

const sessionFileLookup = new Map<string, string>();
const activeSessions = new Map<string, SessionDriver>();
const openingSessions = new Map<string, Promise<SessionDriver | null>>();
let runtimeTransition: Promise<void> | null = null;

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  agentDir,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd, agentDir });
  const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
  return { ...result, services, diagnostics: services.diagnostics };
};

const createSdkDriver = (id: string, sessionFile: string, cwd: string) =>
  new SdkSessionDriver(id, sessionFile, cwd, async () => {
    const sessionManager = SessionManager.open(sessionFile);
    return createAgentSessionRuntime(createRuntime, {
      cwd: sessionManager.getCwd(),
      agentDir: getAgentDir(),
      sessionManager,
    });
  });

const createDriver = (id: string, sessionFile: string, cwd: string, mode: SessionDriverMode): SessionDriver =>
  mode === "sdk" ? createSdkDriver(id, sessionFile, cwd) : new RpcSessionDriver(id, sessionFile, cwd);

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
    const cwd = SessionManager.open(sessionFile).getCwd();
    const driver = createDriver(id, sessionFile, cwd, getRuntimeMode());
    await driver.start();
    activeSessions.set(id, driver);
    return driver;
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
  const driver = activeSessions.get(id);
  if (!driver) return;
  activeSessions.delete(id);
  await driver.dispose();
};

export const deleteSession = async (
  id: string,
): Promise<{ ok: boolean; method: "trash" | "unlink" | "inmemory"; error?: string }> => {
  const driver = activeSessions.get(id);
  if (driver) {
    activeSessions.delete(id);
    await driver.dispose();
  }
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

export const createSessionWithCwd = async (cwd: string): Promise<SdkSessionDriver> => {
  const sessionManager = SessionManager.create(cwd);
  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) throw new Error("Pi did not create a session file");
  const id = sessionManager.getSessionId();
  const driver = createSdkDriver(id, sessionFile, cwd);
  await driver.start();
  activeSessions.set(id, driver);
  sessionFileLookup.set(id, sessionFile);
  return driver;
};

export const switchRuntimeMode = async (
  mode: SessionDriverMode,
  closeChannel: (sessionId: string) => Promise<void>,
) => {
  await loadAppConfig();
  if (runtimeTransition) await runtimeTransition;
  if (mode === getRuntimeMode()) return;

  const drivers = [...activeSessions.entries()];
  const transition = (async () => {
    await Promise.all(drivers.map(async ([, driver]) => {
      await driver.abort().catch(() => undefined);
    }));
    await Promise.all(drivers.map(([sessionId]) => closeChannel(sessionId)));
    activeSessions.clear();
    await Promise.all(drivers.map(async ([, driver]) => {
      await driver.dispose();
    }));
    await setRuntimeMode(mode);
  })();
  runtimeTransition = transition;
  try {
    await transition;
  } finally {
    runtimeTransition = null;
  }
};
