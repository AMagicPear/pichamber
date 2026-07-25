import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ServerWebSocket } from "bun";
import { deactivateSession, getSession } from "./session";
import type { SessionWsData, WsHandler } from "./index";

type BunWS = ServerWebSocket<SessionWsData>;

type SessionChannel = {
  sockets: Set<BunWS>;
  unsubscribe: () => void;
};

// sessionId → one shared SDK listener plus all subscribed sockets.
const channelsBySession = new Map<string, SessionChannel>();

function attachListener(sessionId: string, session: AgentSession): SessionChannel {
  const existing = channelsBySession.get(sessionId);
  if (existing) return existing;

  const channel: SessionChannel = {
    sockets: new Set(),
    unsubscribe: () => undefined,
  };
  channel.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    const payload = JSON.stringify({ type: "event", event });
    for (const bunWS of channel.sockets) {
      if (bunWS.readyState === 1) bunWS.send(payload);
    }
  });
  channelsBySession.set(sessionId, channel);
  return channel;
}

function detachListener(sessionId: string, ws: BunWS): void {
  const channel = channelsBySession.get(sessionId);
  if (!channel) return;
  channel.sockets.delete(ws);
  if (channel.sockets.size !== 0) return;
  channel.unsubscribe();
  channelsBySession.delete(sessionId);
  void deactivateSession(sessionId);
}

export function closeSessionSockets(sessionId: string): void {
  const channel = channelsBySession.get(sessionId);
  if (!channel) return;
  channel.unsubscribe();
  channelsBySession.delete(sessionId);
  for (const ws of channel.sockets) {
    ws.data.closed = true;
    ws.data.attached = false;
    if (ws.readyState === 1) ws.close(1000, "Session deleted");
  }
  channel.sockets.clear();
}

function sendError(ws: BunWS, error: string): void {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", error }));
}

export const sessionWsHandler: WsHandler = {
  async open(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    bunWS.data.closed = false;
    const session = await getSession(sessionId);
    if (bunWS.data.closed) {
      if (!channelsBySession.has(sessionId)) void deactivateSession(sessionId);
      return;
    }
    if (!session) {
      sendError(bunWS, "session not found");
      bunWS.close();
      return;
    }
    const channel = attachListener(sessionId, session);
    channel.sockets.add(bunWS);
    bunWS.data.attached = true;
    bunWS.send(JSON.stringify({ type: "ready", sessionId }));
  },
  async message(ws, message) {
    const bunWS = ws as BunWS;
    if (bunWS.data.closed || !bunWS.data.attached) return;

    let msg: unknown;
    try {
      msg = JSON.parse(typeof message === "string" ? message : message.toString());
    } catch {
      sendError(bunWS, "invalid JSON message");
      return;
    }
    if (!msg || typeof msg !== "object") {
      sendError(bunWS, "message must be an object");
      return;
    }
    const input = msg as { type?: unknown; message?: unknown };
    if (input.type !== "prompt") return;
    if (typeof input.message !== "string") {
      sendError(bunWS, "prompt message must be a string");
      return;
    }
    const { sessionId } = bunWS.data;
    const session = await getSession(sessionId);
    if (bunWS.data.closed) return;
    if (!session) {
      sendError(bunWS, "session not found");
      return;
    }
    // Fire-and-forget: prompt() runs until the retry/queue drains; events
    // flow back via subscribe().
    session
      .prompt(input.message)
      .catch((err: unknown) =>
        sendError(bunWS, String(err)),
      );
  },
  close(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    bunWS.data.closed = true;
    if (!bunWS.data.attached) return;
    bunWS.data.attached = false;
    detachListener(sessionId, bunWS);
  },
};
