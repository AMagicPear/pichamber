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

export async function listAllSessions(): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = await SessionManager.listAll();
  sessionFileLookup.clear();
  for (const session of sessions) {
    sessionFileLookup.set(session.id, session.path);
  }
  return sessions;
}

export async function getSession(id: string): Promise<AgentSession> {
  const cached = activeSessions.get(id);
  if (cached) return cached;
  let sessionFile = sessionFileLookup.get(id);
  if (!sessionFile) {
    await listAllSessions();
    sessionFile = sessionFileLookup.get(id);
    if (!sessionFile) throw new Error(`session of id ${id} does not exist`);
  }
  const sessionManager = SessionManager.open(sessionFile);
  const { session } = await createAgentSession({
    cwd: sessionManager.getCwd(),
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
  });
  activeSessions.set(id, session);
  return session;
}

export async function removeSession(id: string) {
  const session = activeSessions.get(id);
  if (!session) return;
  session.dispose();
  activeSessions.delete(id);
}

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
