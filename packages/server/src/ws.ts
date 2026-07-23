import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ServerWebSocket } from "bun";
import { deactivateSession, getSession } from "./session";

// 每个 ws 自带 data.sessionId（Bun.serve upgrade 时塞入）
type WSData = { sessionId: string };
type BunWS = ServerWebSocket<WSData>;

// sessionId → 所有订阅此 session 的 ws（支持多 tab 看同一 session）
const socketsBySession = new Map<string, Set<BunWS>>();

// 首次有 ws 连进来才挂 SDK listener；同一 session 后续 ws 复用同一 listener
const attachListener = (sessionId: string, session: AgentSession) => {
  if (socketsBySession.has(sessionId)) return;
  const sockets = new Set<BunWS>();
  session.subscribe((event: AgentSessionEvent) => {
    const payload = JSON.stringify({ type: "event", event });
    for (const bunWS of sockets) bunWS.send(payload);
  });
  socketsBySession.set(sessionId, sockets);
};

// Y 策略：最后一个 ws 关就 dispose
const detachListener = (sessionId: string, ws: BunWS) => {
  const sockets = socketsBySession.get(sessionId);
  if (!sockets) return;
  sockets.delete(ws);
  if (sockets.size !== 0) return;
  socketsBySession.delete(sessionId);
  deactivateSession(sessionId);
};

export const wsHandlers = {
  async open(ws: BunWS) {
    const { sessionId } = ws.data;
    const session = await getSession(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: "error", error: "session not found" }));
      ws.close();
      return;
    }
    attachListener(sessionId, session);
    socketsBySession.get(sessionId)!.add(ws);
    ws.send(JSON.stringify({ type: "ready", sessionId }));
  },
  async message(ws: BunWS, message: string | Buffer) {
    const msg = JSON.parse(message as string);
    if (msg.type !== "prompt") return;
    const { sessionId } = ws.data;
    const session = await getSession(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: "error", error: "session not found" }));
      return;
    }
    // fire-and-forget：prompt() 会等到 retry/queue 全部结束，事件通过 subscribe() 流推
    session
      .prompt(msg.message)
      .catch((err: unknown) => ws.send(JSON.stringify({ type: "error", error: String(err) })));
  },
  close(ws: BunWS) {
    const { sessionId } = ws.data;
    detachListener(sessionId, ws);
  },
};
