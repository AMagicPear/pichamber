/**
 * Session lifecycle helpers.
 *
 * Owns the per-session `SessionRuntime` map and exposes the few queries
 * the HTTP/WS layer needs (resolve by id, cwd lookup, listing). The
 * runtime choice (SDK vs RPC) lives in `server-settings.ts`; see
 * `runtime.ts` for the abstraction.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { toMessage } from "../error";
import {
  type SessionRuntime,
  createSessionRuntime,
} from "./runtime";

const sessionFileLookup = new Map<string, string>();
const activeSessions = new Map<string, SessionRuntime>();
const openingSessions = new Map<string, Promise<SessionRuntime | null>>();

const removeRuntime = (runtime: SessionRuntime) => {
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

/** Activate (or fetch) the runtime for a session id. RPC-backed sessions
 *  spin up a subprocess on first call; SDK sessions are reused from the
 *  in-memory cache. */
export const getSession = async (id: string): Promise<SessionRuntime | null> => {
  const cached = activeSessions.get(id);
  if (cached) return cached;
  const opening = openingSessions.get(id);
  if (opening) return opening;

  const create = (async () => {
    const sessionFile = await getSessionFileWithId(id);
    if (!sessionFile) return null;
    const runtime = await createSessionRuntime({ cwd: await resolveSessionCwd(sessionFile), sessionFile });
    activeSessions.set(id, runtime);
    if (runtime.sessionId !== id) activeSessions.set(runtime.sessionId, runtime);
    return runtime;
  })();
  openingSessions.set(id, create);
  try {
    return await create;
  } finally {
    openingSessions.delete(id);
  }
};

/** Open an existing session file. The runtime decides which cwd to
 *  bind based on the file's metadata. */
const resolveSessionCwd = async (sessionFile: string): Promise<string> => {
  // SDK path: the session manager reports the cwd of the file directly.
  return SessionManager.open(sessionFile).getCwd();
};

export const getSessionCwd = async (id: string): Promise<string | null> => {
  const active = activeSessions.get(id);
  if (active) return active.cwd;
  const sessionFile = await getSessionFileWithId(id);
  if (!sessionFile) return null;
  return SessionManager.open(sessionFile).getCwd();
};

export const getSessionFile = (id: string): string | undefined =>
  sessionFileLookup.get(id);

export const deactivateSession = async (id: string) => {
  const runtime = activeSessions.get(id);
  if (!runtime) return;
  await runtime.dispose();
  removeRuntime(runtime);
};

/** Same delete flow as before, but works on whichever runtime the
 *  session is bound to (SDK or RPC). RPC processes exit on dispose;
 *  SDK sessions just tear down their listener. */
export const deleteSession = async (
  id: string,
): Promise<{ ok: boolean; method: "trash" | "unlink" | "inmemory"; error?: string }> => {
  const session = activeSessions.get(id);
  if (session) {
    await session.dispose();
    removeRuntime(session);
  }
  const sessionPath = session?.sessionFile ?? sessionFileLookup.get(id);
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

export const createSessionWithCwd = async (cwd: string): Promise<SessionRuntime> => {
  const runtime = await createSessionRuntime({ cwd });
  activeSessions.set(runtime.sessionId, runtime);
  return runtime;
};
