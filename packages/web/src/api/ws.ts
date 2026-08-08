import type { ConversationMessage, ServerMessage } from "@pichamber/shared";

export type WsHandle = {
  send: (message: unknown) => void;
  close: () => void;
};

/** Connection lifecycle status — distilled from server messages + transport events. */
export type WsStatus =
  | { type: "ready"; messages?: ConversationMessage[] }
  | { type: "error"; error: string }
  | { type: "closed"; code?: number; reason?: string };

export const wsUrl = (path: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}//${location.host}${normalized}`;
};

/** Connect to the Pi AgentSession JSON protocol. */
export const connectSessionWs = (
  sessionId: string,
  onMessage: (message: ConversationMessage) => void,
  onStatus?: (status: WsStatus) => void,
): WsHandle => {
  const socket = new WebSocket(wsUrl(`/ws/${sessionId}`));

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data) as ServerMessage;
    if (msg.type === "message") onMessage(msg.message);
    else if (msg.type === "ready") onStatus?.({ type: "ready", messages: msg.messages });
    else if (msg.type === "error")
      onStatus?.({ type: "error", error: String(msg.error ?? "unknown error") });
  };
  socket.onclose = (event) => {
    onStatus?.({ type: "closed", code: event.code, reason: event.reason });
  };
  socket.onerror = () => onStatus?.({ type: "error", error: "Transport error" });

  return {
    send: (message) => socket.send(JSON.stringify(message)),
    close: () => socket.close(),
  };
};

export type SessionStatus = WsStatus;
export const connectWs = connectSessionWs;

/** Connect to a PTY terminal WebSocket. Output is raw text; input accepts
 *  strings (stdin keystrokes) or objects (JSON control frames like resize). */
export const connectPtyWs = (
  ptyId: string,
  onData: (data: string) => void,
  onStatus?: (status: WsStatus) => void,
): WsHandle => {
  const socket = new WebSocket(wsUrl(`/ws/pty/${encodeURIComponent(ptyId)}`));

  socket.onopen = () => onStatus?.({ type: "ready" });
  socket.onmessage = (event) => {
    if (typeof event.data === "string") onData(event.data);
  };
  socket.onclose = (event) => {
    onStatus?.({ type: "closed", code: event.code, reason: event.reason });
  };
  socket.onerror = () => onStatus?.({ type: "error", error: "Transport error" });

  return {
    send: (message) => {
      socket.send(typeof message === "string" ? message : JSON.stringify(message));
    },
    close: () => socket.close(),
  };
};
