import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ServerWebSocket } from "bun";
import { deactivateSession, getSession } from "./session";
import type { SessionWsData, WsHandler } from "./index";

type BunWS = ServerWebSocket<SessionWsData>;

// sessionId → all ws that are subscribed to this session. Multiple tabs
// watching the same session share one SDK listener.
const socketsBySession = new Map<string, Set<BunWS>>();

// First ws per session attaches the SDK listener; subsequent ws reuse it.
const attachListener = (sessionId: string, session: AgentSession) => {
  if (socketsBySession.has(sessionId)) return;
  const sockets = new Set<BunWS>();
  session.subscribe((event: AgentSessionEvent) => {
    const payload = JSON.stringify({ type: "event", event });
    for (const bunWS of sockets) bunWS.send(payload);
  });
  socketsBySession.set(sessionId, sockets);
};

// Y strategy: when the last ws disconnects we dispose the session.
const detachListener = (sessionId: string, ws: BunWS) => {
  const sockets = socketsBySession.get(sessionId);
  if (!sockets) return;
  sockets.delete(ws);
  if (sockets.size !== 0) return;
  socketsBySession.delete(sessionId);
  deactivateSession(sessionId);
};

export const sessionWsHandler: WsHandler = {
  async open(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    const session = await getSession(sessionId);
    if (!session) {
      bunWS.send(JSON.stringify({ type: "error", error: "session not found" }));
      bunWS.close();
      return;
    }
    attachListener(sessionId, session);
    socketsBySession.get(sessionId)!.add(bunWS);
    bunWS.send(JSON.stringify({ type: "ready", sessionId }));
  },
  async message(ws, message) {
    const bunWS = ws as BunWS;
    const msg = JSON.parse(message as string);
    if (msg.type !== "prompt") return;
    const { sessionId } = bunWS.data;
    const session = await getSession(sessionId);
    if (!session) {
      bunWS.send(JSON.stringify({ type: "error", error: "session not found" }));
      return;
    }
    // Fire-and-forget: prompt() runs until the retry/queue drains; events
    // flow back via subscribe().
    session
      .prompt(msg.message)
      .catch((err: unknown) =>
        bunWS.send(JSON.stringify({ type: "error", error: String(err) })),
      );
  },
  close(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    detachListener(sessionId, bunWS);
  },
};
