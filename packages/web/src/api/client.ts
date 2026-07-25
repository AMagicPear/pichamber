// REST client — every request goes through Vite's `/api` proxy to the
// Bun server on :3000. The single `jsonOrThrow` helper centralises error
// handling so each call site is a one-liner.

const BASE = "/api";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    const message =
      typeof data?.error === "string" ? data.error : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

// ─── AI sessions ──────────────────────────────────────────────────────

export const listSessions = () =>
  fetch(`${BASE}/sessions`).then((r) => jsonOrThrow<unknown[]>(r));

export const createSession = (cwd: string) =>
  fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  }).then((r) => jsonOrThrow<{ sessionId: string }>(r));

export const getEntries = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`).then((r) => jsonOrThrow<unknown[]>(r));

export const deleteSession = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`, { method: "DELETE" }).then((r) =>
    jsonOrThrow<{ ok: true }>(r),
  );

// ─── Terminal (PTY) ───────────────────────────────────────────────────

export interface PtyStartOptions {
  /** Working directory for the spawned shell. Defaults to the user's home. */
  cwd?: string;
  cols: number;
  rows: number;
  /** Override the shell binary. Defaults to $SHELL (or `cmd.exe` on Win). */
  shell?: string;
}

export interface PtyStartResult {
  ptyId: string;
  shell: string;
  cwd: string;
  /**
   * Display title for the tab. Server computes this from the cwd so we
   * never duplicate the `~/` collapsing logic in the client.
   */
  title: string;
}

export const startPty = (options: PtyStartOptions) =>
  fetch(`${BASE}/pty/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  }).then((r) => jsonOrThrow<PtyStartResult>(r));
