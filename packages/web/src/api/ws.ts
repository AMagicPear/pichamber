// WebSocket client helpers — every WS in the app routes through the Vite
// proxy (`/ws/*` → `ws://localhost:3000/ws/*`), so the only WebSocket
// construction we ever need is `wsUrl(path)` + a `new WebSocket(...)` call
// (or one of the convenience wrappers below for the protocols we currently
// have).
//
// Two protocols live here today:
//   - AI session: `/ws/:sessionId` (JSON envelopes, see ./ws.ts original)
//   - PTY:        `/ws/pty/:ptyId` (raw bytes + JSON control frames)
//
// They return different abstractions on purpose: the AI session protocol is
// JSON-in/JSON-out with a small set of well-typed messages, so we wrap it in
// a `WsHandle`. The PTY protocol is byte-stream (keystrokes, paste) plus
// occasional control frames, so the call site needs the raw `WebSocket` to
// set up heterogeneous listeners. If a third protocol shows up that fits
// the JSON-in/JSON-out mold, add a `connect*` wrapper following the AI
// session pattern. If it's byte-stream, follow the PTY pattern.

/**
 * Build an absolute WebSocket URL for the given server path. Handles the
 * `ws:` vs `wss:` choice based on the current page protocol so we work
 * identically in dev (http://) and a future https:// deployment.
 */
export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${proto}//${location.host}${normalized}`;
}

// ─── AI session WS ─────────────────────────────────────────────────────
//
// Browser connects to ws://host/ws/:sessionId (via Vite proxy) and gets back
// SDK AgentSessionEvent envelopes. The handle hides the underlying WebSocket
// so callers don't have to JSON.stringify on every send.

export type SessionEvent = {
  type: string;
  [k: string]: unknown;
};

export type WsHandle = {
  send: (msg: unknown) => void;
  close: () => void;
};

export function connectWs(
  sessionId: string,
  onEvent: (event: SessionEvent) => void,
): WsHandle {
  const ws = new WebSocket(wsUrl(`/ws/${sessionId}`));

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "event") onEvent(msg.event as SessionEvent);
    else console.log("[ws msg]", msg);
  };
  ws.onopen = () => console.log("[ws open]", sessionId);
  ws.onclose = () => console.log("[ws close]", sessionId);
  ws.onerror = (e) => console.error("[ws error]", sessionId, e);

  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => ws.close(),
  };
}

// ─── PTY WS ────────────────────────────────────────────────────────────
//
// The PTY protocol is intentionally minimal:
//   client → server: any string = stdin bytes
//                    `{"type":"resize","cols":N,"rows":M}` = control frame
//   server → client: any string = stdout bytes (ANSI escape sequences)
//
// We return the raw WebSocket because the call site owns the heterogeneous
// listeners (onopen for initial resize, onmessage for stdout, onclose for
// the "shell exited" UI state).

export function ptyWs(ptyId: string): WebSocket {
  return new WebSocket(wsUrl(`/ws/pty/${encodeURIComponent(ptyId)}`));
}
