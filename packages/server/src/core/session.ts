/**
 * Session lifecycle helpers.
 *
 * Owns the per-session `AgentSessionRuntime` map and exposes the few queries
 * the HTTP/WS layer needs (resolve by id, cwd lookup, listing). Every
 * session is backed by Pi's official `AgentSessionRuntime`; the module-scope
 * `createRuntime` factory is what the runtime stores so /new /resume /fork
 * flows can rebuild it against the same cwd-bound services.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type SessionInfo,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { toMessage } from "../error";

const sessionFileLookup = new Map<string, string>();
const activeSessions = new Map<string, AgentSessionRuntime>();
const openingSessions = new Map<string, Promise<AgentSessionRuntime | null>>();

/** Recreate cwd-bound services for a session. Shared by every session; the
 *  returned `services` + `diagnostics` are what make this a
 *  `CreateAgentSessionRuntimeFactory` (vs the plain
 *  `createAgentSessionFromServices`) so future /new /resume /fork flows can
 *  rebuild the runtime against the same services. */
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

const removeRuntime = (runtime: AgentSessionRuntime) => {
  for (const [id, active] of activeSessions) {
    if (active === runtime) activeSessions.delete(id);
  }
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
  const sessions: SessionInfo[] = await SessionManager.listAll();
  sessionFileLookup.clear();
  for (const session of sessions) {
    sessionFileLookup.set(session.id, session.path);
  }
  return sessions;
};

/** Activate (or fetch) the runtime for a session id. Cached by id; concurrent
 *  callers share one open promise. */
export const getSession = async (id: string): Promise<AgentSessionRuntime | null> => {
  const cached = activeSessions.get(id);
  if (cached) return cached;
  const opening = openingSessions.get(id);
  if (opening) return opening;

  const create = (async () => {
    const sessionFile = await getSessionFileWithId(id);
    if (!sessionFile) return null;
    // Resume the file: its header cwd is authoritative.
    const sessionManager = SessionManager.open(sessionFile);
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: sessionManager.getCwd(),
      agentDir: getAgentDir(),
      sessionManager,
    });
    activeSessions.set(id, runtime);
    if (runtime.session.sessionId !== id) activeSessions.set(runtime.session.sessionId, runtime);
    return runtime;
  })();
  openingSessions.set(id, create);
  try {
    return await create;
  } finally {
    openingSessions.delete(id);
  }
};

export const getSessionCwd = async (id: string): Promise<string | null> => {
  const active = activeSessions.get(id);
  if (active) return active.services.cwd;
  const sessionFile = await getSessionFileWithId(id);
  if (!sessionFile) return null;
  return SessionManager.open(sessionFile).getCwd();
};

export const deactivateSession = async (id: string) => {
  const runtime = activeSessions.get(id);
  if (!runtime) return;
  await runtime.dispose();
  removeRuntime(runtime);
};

export const deleteSession = async (
  id: string,
): Promise<{ ok: boolean; method: "trash" | "unlink" | "inmemory"; error?: string }> => {
  const session = activeSessions.get(id);
  if (session) {
    await session.dispose();
    removeRuntime(session);
  }
  const sessionPath = session?.session.sessionFile ?? sessionFileLookup.get(id);
  if (!sessionPath) {
    sessionFileLookup.delete(id);
    return { ok: true, method: "inmemory" };
  }
  const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
  const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

  const getTrashErrorHint = (): string | null => {
    const parts: string[] = [];
    if (trashResult.error) parts.push(trashResult.error.message);
    const stderr = trashResult.stderr?.trim();
    if (stderr) parts.push(stderr.split("\n")[0] ?? stderr);
    return parts.length === 0 ? null : `trash: ${parts.join(" · ").slice(0, 200)}`;
  };

  if (trashResult.status === 0 || !existsSync(sessionPath)) {
    sessionFileLookup.delete(id);
    return { ok: true, method: "trash" };
  }

  try {
    await unlink(sessionPath);
    sessionFileLookup.delete(id);
    return { ok: true, method: "unlink" };
  } catch (err) {
    const unlinkError = toMessage(err);
    const trashErrorHint = getTrashErrorHint();
    const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
    return { ok: false, method: "unlink", error };
  }
};

export const createSessionWithCwd = async (cwd: string): Promise<AgentSessionRuntime> => {
  const sessionManager = SessionManager.create(cwd);
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager,
  });
  activeSessions.set(runtime.session.sessionId, runtime);
  return runtime;
};
