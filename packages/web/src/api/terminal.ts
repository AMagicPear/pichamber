/**
 * Terminal API client — spawns real shells via the server and opens a PTY
 * WebSocket. Mirrors the legacy `api/client.ts` helpers but routes through
 * Vite's `/api` and `/ws` proxies.
 */

export interface PtyStartOptions {
  cwd?: string;
  cols: number;
  rows: number;
  shell?: string;
}

export interface PtyStartResult {
  ptyId: string;
  shell: string;
  cwd: string;
}

/**
 * Ask the server to spawn a new PTY. The returned `ptyId` is needed to open
 * the WebSocket on `/ws/pty/:ptyId`.
 */
export async function startPty(options: PtyStartOptions): Promise<PtyStartResult> {
  const res = await fetch("/api/pty/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to start PTY (${res.status})`);
  }
  return (await res.json()) as PtyStartResult;
}

/**
 * Open the bidirectional WebSocket that bridges a ghostty-web Terminal to
 * the server-side PTY. Returns the raw `WebSocket` so callers can attach
 * their own listeners — the protocol is intentionally simple:
 *
 *   client → server: any string = stdin bytes
 *                    `{"type":"resize","cols":N,"rows":M}` = control frame
 *   server → client: any string = stdout bytes (ANSI escape sequences)
 */
export function ptyWs(ptyId: string): WebSocket {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${proto}//${location.host}/ws/pty/${encodeURIComponent(ptyId)}`);
}
