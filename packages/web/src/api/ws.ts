/** WebSocket URLs and the PTY connection constructor. */

export function wsUrl(path: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}//${location.host}${normalized}`;
}

export function ptyWs(ptyId: string): WebSocket {
  return new WebSocket(wsUrl(`/ws/pty/${encodeURIComponent(ptyId)}`));
}
