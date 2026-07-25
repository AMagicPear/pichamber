/** WebSocket URLs and the PTY connection constructor. */

export type SessionEvent = {
  type: string;
  [key: string]: unknown;
};

export type WsHandle = {
  send: (message: unknown) => void;
  close: () => void;
};

export function wsUrl(path: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}//${location.host}${normalized}`;
}

/** Connect to the Pi AgentSession JSON protocol. */
export function connectWs(
  sessionId: string,
  onEvent: (event: SessionEvent) => void,
): WsHandle {
  const socket = new WebSocket(wsUrl(`/ws/${sessionId}`));

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "event") onEvent(message.event as SessionEvent);
    else console.log("[ws msg]", message);
  };
  socket.onopen = () => console.log("[ws open]", sessionId);
  socket.onclose = () => console.log("[ws close]", sessionId);
  socket.onerror = (event) => console.error("[ws error]", sessionId, event);

  return {
    send: (message) => socket.send(JSON.stringify(message)),
    close: () => socket.close(),
  };
}

export function ptyWs(ptyId: string): WebSocket {
  return new WebSocket(wsUrl(`/ws/pty/${encodeURIComponent(ptyId)}`));
}
