import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ServerWebSocket } from "bun";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { deactivateSession, getSession } from "./session";

// 用 Bun WS（ws.raw）作为连接身份 —— hono/bun 每次事件都 new 一个 WSContext 包装器，
// Set/Map 的对象等同性会让 add 和 delete 命中不同对象，必须用底层稳定身份
type BunWS = ServerWebSocket<unknown>;

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

// ws 关了就移出 Set；如果这是该 session 最后一个 ws，整个 dispose 掉（Y 策略）
// 注意：刚 POST 没 prompt 的会话不会落盘，dispose 后 GET 会 404 — 这是 pi 的设计，
// "没发过消息的会话"等同于不存在，不要为之特殊处理
const detachListener = (sessionId: string, ws: WSContext) => {
  const sockets = socketsBySession.get(sessionId);
  if (!sockets) return;
  const raw = ws.raw as BunWS | undefined;
  if (raw) sockets.delete(raw);
  if (sockets.size !== 0) return;
  socketsBySession.delete(sessionId);
  deactivateSession(sessionId);
};

export const wsHandler = upgradeWebSocket(async (c) => {
  // 路由 "/ws/:id" 保证有 id；Hono 类型无法提取路径参数，所以断言
  const sessionId = c.req.param("id")!;
  return {
    onOpen: async (_evt, ws) => {
      const session = await getSession(sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: "error", error: "session not found" }));
        ws.close();
        return;
      }
      attachListener(sessionId, session);
      const raw = ws.raw as BunWS | undefined;
      if (raw) socketsBySession.get(sessionId)!.add(raw);
      ws.send(JSON.stringify({ type: "ready", sessionId }));
    },
    onMessage: async (evt, ws) => {
      const msg = JSON.parse(evt.data as string);
      if (msg.type !== "prompt") return;
      const session = await getSession(sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: "error", error: "session not found" }));
        return;
      }
      // fire-and-forget：prompt() 会等到 retry/queue 全部结束，事件通过 subscribe() 流推
      session.prompt(msg.message).catch((err) =>
        ws.send(JSON.stringify({ type: "error", error: String(err) })),
      );
    },
    onClose: (_evt, ws) => {
      detachListener(sessionId, ws);
    },
  };
});