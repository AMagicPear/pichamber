import {
  type AgentSession,
  createAgentSession,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

// Per-session agent pool (one AgentSession per active session path)
const sessions = new Map<string, AgentSession>();

export async function getSession(sessionPath: string): Promise<AgentSession> {
  const cached = sessions.get(sessionPath);
  if (cached) return cached;

  const sessionManager = SessionManager.open(sessionPath);
  const { session } = await createAgentSession({
    cwd: sessionManager.getCwd(),
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
  });
  sessions.set(sessionPath, session);
  return session;
}

export async function removeSession(sessionPath: string): Promise<void> {
  const session = sessions.get(sessionPath);
  if (!session) return;
  session.dispose();
  sessions.delete(sessionPath);
}
