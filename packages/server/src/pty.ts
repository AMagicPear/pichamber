/**
 * PTY state — real shell sessions backed by Bun's native PTY.
 *
 * One module-scoped `handles` Map per process. Each `ptyId` is the key for
 * a single Bun.Terminal + child process pair. Subscribers (WebSocket senders)
 * are added per connection; when the WS closes we stop the shell.
 *
 * This module follows the same shape as ./session.ts and ./ws.ts (module
 * level Maps + exported functions + an exported `ptyHandlers` object for
 * the WebSocket lifecycle), so adding a new server-side resource doesn't
 * require learning a new pattern.
 */

import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { getHomeDir } from "./home";

// ─── Types ─────────────────────────────────────────────────────────────

export interface PtyHandle {
  id: string;
  terminal: Bun.Terminal;
  proc: Bun.Subprocess;
  subscribers: Set<(data: string) => void>;
  shell: string;
  cwd: string;
  title: string;
}

export interface PtyStartOptions {
  /** Working directory for the spawned shell. Defaults to the user's home. */
  cwd?: string;
  cols: number;
  rows: number;
  /** Override the shell binary. Defaults to $SHELL or platform default. */
  shell?: string;
}

export interface PtyStartResult {
  ptyId: string;
  shell: string;
  cwd: string;
  /** Display title (`~`, `~/projects/foo`, or full path). */
  title: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────

function getDefaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === "win32") return process.env.COMSPEC ?? "cmd.exe";
  return "/bin/sh";
}

function shortPath(cwd: string): string {
  const home = getHomeDir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

function resolveCwd(input: string | undefined): string {
  const fallback = getHomeDir();
  if (!input) return fallback;
  const cwd = isAbsolute(input) ? input : resolve(process.cwd(), input);
  try {
    const stat = statSync(cwd);
    if (!stat.isDirectory()) return fallback;
    return cwd;
  } catch {
    return fallback;
  }
}

// ─── State ─────────────────────────────────────────────────────────────

const handles = new Map<string, PtyHandle>();

export function hasPty(ptyId: string): boolean {
  return handles.has(ptyId);
}

// ─── Lifecycle ─────────────────────────────────────────────────────────

export function startPty(options: PtyStartOptions): PtyStartResult {
  const cwd = resolveCwd(options.cwd);
  const shell = options.shell ?? getDefaultShell();
  const id = crypto.randomUUID();

  // Forward-declared so the Bun.Terminal `data` callback can close over it
  // before the handle is fully constructed.
  let handle: PtyHandle | undefined;

  const terminal = new Bun.Terminal({
    cols: Math.max(2, Math.floor(options.cols)),
    rows: Math.max(2, Math.floor(options.rows)),
    data: (_term, data) => {
      if (!handle) return;
      const text = new TextDecoder().decode(data);
      for (const sub of handle.subscribers) sub(text);
    },
  });

  const proc = Bun.spawn([shell], {
    cwd,
    terminal,
    env: process.env,
  });

  handle = {
    id,
    terminal,
    proc,
    subscribers: new Set(),
    shell,
    cwd,
    title: shortPath(cwd),
  };
  handles.set(id, handle);

  proc.exited.then(() => {
    const h = handles.get(id);
    if (!h) return;
    for (const sub of h.subscribers) sub("\x1b[33mTerminal exited\x1b[0m\r\n");
    h.subscribers.clear();
    try {
      terminal.close();
    } catch {
      /* ignore */
    }
  });

  return { ptyId: id, shell, cwd, title: handle.title };
}

/** Push raw stdin bytes into the shell (keystrokes, pasted text, etc.). */
export function writePty(ptyId: string, data: string): void {
  const handle = handles.get(ptyId);
  if (!handle) throw new Error("Terminal is not running");
  handle.terminal.write(data);
}

export function resizePty(ptyId: string, cols: number, rows: number): void {
  const handle = handles.get(ptyId);
  if (!handle) throw new Error("Terminal is not running");
  handle.terminal.resize(Math.max(2, Math.floor(cols)), Math.max(2, Math.floor(rows)));
}

/**
 * Register a chunk sink for a PTY. Returns an unsubscribe function. Used by
 * the WebSocket handler — every chunk the PTY emits is forwarded to the
 * subscriber until the WS closes.
 */
export function subscribePty(ptyId: string, cb: (data: string) => void): () => void {
  const handle = handles.get(ptyId);
  if (!handle) throw new Error("PTY not found");
  handle.subscribers.add(cb);
  return () => {
    handle.subscribers.delete(cb);
  };
}

/**
 * Force-stop a single PTY. Called on WS close so the shell dies with the
 * browser tab. Idempotent — missing ids are no-ops.
 */
export function stopPty(ptyId: string): void {
  const handle = handles.get(ptyId);
  if (!handle) return;
  try {
    handle.proc.kill();
  } catch {
    /* ignore */
  }
  try {
    handle.terminal.close();
  } catch {
    /* ignore */
  }
  handles.delete(ptyId);
}

/** Best-effort cleanup for SIGINT/SIGTERM. */
export function stopAllPtys(): void {
  for (const id of handles.keys()) stopPty(id);
}

// Re-exported so the client only needs the title once we hand back
// `PtyStartResult` (it never has to compute `~/foo` itself).
export { shortPath };
