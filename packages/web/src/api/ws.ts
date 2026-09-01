import type { ClientMessage, ServerMessage } from "@amagicpear/pichamber-shared";

export type WsHandle<Outgoing> = {
  send: (message: Outgoing) => void;
  close: () => void;
};

/** Connection lifecycle status — distilled from transport events only.
 *  Protocol messages (snapshot/event/state/error) go straight to onMessage. */
export type WsStatus =
  | { type: "ready" }
  | { type: "error"; error: string }
  | { type: "closed"; code?: number; reason?: string };

export const wsUrl = (path: string) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}//${location.host}${normalized}`;
};

/**
 * Shared socket plumbing: transport error → `error` status, close → `closed`
 * status. `onMessage` receives each text frame; `encode` serializes what
 * `send()` passes (JSON for the session protocol, raw stdin for the PTY).
 */
const createSocket = <Outgoing>(
  url: string,
  onMessage: (data: string) => void,
  onStatus?: (status: WsStatus) => void,
  encode: (message: Outgoing) => string = (message) => JSON.stringify(message),
  onOpen?: () => void,
): WsHandle<Outgoing> => {
  const socket = new WebSocket(url);
  socket.onopen = () => onOpen?.();
  socket.onmessage = (event) => onMessage(String(event.data));
  socket.onclose = (event) => onStatus?.({ type: "closed", code: event.code, reason: event.reason });
  socket.onerror = () => onStatus?.({ type: "error", error: "Transport error" });
  return {
    send: (message) => socket.send(encode(message)),
    close: () => socket.close(),
  };
};

/** Connect to the session WebSocket. The server's first frame is a snapshot
 *  carrying the full item list; every later frame is item/state/error. */
export const connectSessionWs = (
  sessionId: string,
  onMessage: (message: ServerMessage) => void,
  onStatus?: (status: WsStatus) => void,
  onOpen?: () => void,
): WsHandle<ClientMessage> =>
  createSocket(
    wsUrl(`/ws/${sessionId}`),
    (data) => {
      onMessage(JSON.parse(data) as ServerMessage);
    },
    onStatus,
    undefined,
    onOpen,
  );

export type PtyMessage = string | { type: "resize"; cols: number; rows: number };

/** Connect to a PTY terminal WebSocket. Output is raw text; input accepts
 *  strings (stdin keystrokes) or objects (JSON control frames like resize).
 *  The server sends nothing on connect, so the transport opening IS the
 *  ready signal. */
export const connectPtyWs = (
  ptyId: string,
  onData: (data: string) => void,
  onStatus?: (status: WsStatus) => void,
): WsHandle<PtyMessage> =>
  createSocket(
    wsUrl(`/ws/pty/${encodeURIComponent(ptyId)}`),
    onData,
    onStatus,
    (message) => (typeof message === "string" ? message : JSON.stringify(message)),
    () => onStatus?.({ type: "ready" }),
  );
