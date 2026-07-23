import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import {
  type AgentSession,
  createAgentSession,
  getAgentDir,
  type SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

// 用于快速根据ID查找会话文件位置
const sessionFileLookup = new Map<string, string>();

// 所有活跃的会话可以并行存在
const activeSessions = new Map<string, AgentSession>();

// 通过ID查找文件位置
const getSessionFileWithId = async (id: string): Promise<string | null> => {
  let sessionFile = sessionFileLookup.get(id);
  if (!sessionFile) {
    // 找不到的情况下重新更新一次查找表再找
    await listAllSessions();
    sessionFile = sessionFileLookup.get(id);
  }
  // 确实没有的话就返回null
  if (!sessionFile) return null;
  return sessionFile;
};

// 这里每次列出所有会话以后都会更新一次查找表
export const listAllSessions = async (): Promise<SessionInfo[]> => {
  const sessions: SessionInfo[] = await SessionManager.listAll();
  sessionFileLookup.clear();
  for (const session of sessions) {
    sessionFileLookup.set(session.id, session.path);
  }
  return sessions;
};

export const getSession = async (id: string): Promise<AgentSession | null> => {
  // 先找活跃会话
  const cached = activeSessions.get(id);
  if (cached) return cached;
  // 然后找静态文件的会话
  const sessionFile = await getSessionFileWithId(id);
  if (!sessionFile) return null; // 都没有说明就是没这个id的会话
  // 找到静态的会话以后创建活跃会话对象返回出去
  const sessionManager = SessionManager.open(sessionFile);
  const { session } = await createAgentSession({
    cwd: sessionManager.getCwd(),
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
  });
  activeSessions.set(id, session);
  return session;
};

// 将某个会话移出活跃会话，下次就要重新加载
export const deactivateSession = async (id: string) => {
  const session = activeSessions.get(id);
  if (!session) return;
  session.dispose();
  activeSessions.delete(id);
};

/**
 * 删除会话：清理内存中的 AgentSession + 删除本地 jsonl 文件
 * 从 pi packages/coding-agent/src/modes/interactive/components/session-selector.ts 复制
 */
export const deleteSession = async (
  id: string,
): Promise<{ ok: boolean; method: "trash" | "unlink" | "inmemory"; error?: string }> => {
  const session = await getSession(id);
  if (!session) return { ok: false, method: "inmemory", error: "ID对应的会话不存在" };
  session.dispose();
  activeSessions.delete(id);
  const sessionPath = session.sessionFile;
  if (!sessionPath) return { ok: true, method: "inmemory" };
  // Try `trash` first (if installed)
  const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
  const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

  const getTrashErrorHint = (): string | null => {
    const parts: string[] = [];
    if (trashResult.error) {
      parts.push(trashResult.error.message);
    }
    const stderr = trashResult.stderr?.trim();
    if (stderr) {
      parts.push(stderr.split("\n")[0] ?? stderr);
    }
    if (parts.length === 0) return null;
    return `trash: ${parts.join(" · ").slice(0, 200)}`;
  };

  // If trash reports success, or the file is gone afterwards, treat it as successful
  if (trashResult.status === 0 || !existsSync(sessionPath)) {
    return { ok: true, method: "trash" };
  }

  // Fallback to permanent deletion
  try {
    await unlink(sessionPath);
    return { ok: true, method: "unlink" };
  } catch (err) {
    const unlinkError = err instanceof Error ? err.message : String(err);
    const trashErrorHint = getTrashErrorHint();
    const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
    return { ok: false, method: "unlink", error };
  }
};

export async function createSessionWithCwd(cwd: string): Promise<AgentSession> {
  const sessionManager = SessionManager.create(cwd);
  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
  });
  activeSessions.set(session.sessionId, session);
  return session;
}
