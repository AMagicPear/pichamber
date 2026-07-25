/**
 * PTY state — real shell sessions backed by Bun's native PTY.
 *
 * One PtyState per process. Each ptyId is the key for a single Bun.Terminal +
 * child process pair. Subscribers (WebSocket senders) are added per connection;
 * when the last subscriber drops, the process is killed and the handle cleared.
 */

import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { getHomeDir } from "./home";

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
  /** Working directory for the spawned shell. Defaults to the user's home dir. */
  cwd?: string;
  cols: number;
  rows: number;
  /** Override the shell binary (defaults to $SHELL or platform default). */
  shell?: string;
}

export class PtyState {
  private handles = new Map<string, PtyHandle>();

  private getDefaultShell(): string {
    if (process.env.SHELL) return process.env.SHELL;
    if (process.platform === "win32") return process.env.COMSPEC ?? "cmd.exe";
    return "/bin/sh";
  }

  private resolveCwd(input: string | undefined): string {
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

  start(options: PtyStartOptions): { ptyId: string; shell: string; cwd: string } {
    const cwd = this.resolveCwd(options.cwd);
    const shell = options.shell ?? this.getDefaultShell();
    const id = crypto.randomUUID();

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
      title: cwd === getHomeDir() ? "~" : shortPath(cwd),
    };
    this.handles.set(id, handle);

    proc.exited.then(() => {
      const h = this.handles.get(id);
      if (!h) return;
      for (const sub of h.subscribers) sub("\x1b[33mTerminal exited\x1b[0m\r\n");
      h.subscribers.clear();
      try {
        terminal.close();
      } catch {
        /* ignore */
      }
    });

    return { ptyId: id, shell, cwd };
  }

  /** Push raw stdin bytes into the shell (keystrokes, pasted text, etc.). */
  write(ptyId: string, data: string): void {
    const handle = this.handles.get(ptyId);
    if (!handle) throw new Error("Terminal is not running");
    handle.terminal.write(data);
  }

  resize(ptyId: string, cols: number, rows: number): void {
    const handle = this.handles.get(ptyId);
    if (!handle) throw new Error("Terminal is not running");
    handle.terminal.resize(Math.max(2, Math.floor(cols)), Math.max(2, Math.floor(rows)));
  }

  /**
   * Register a chunk sink for a PTY. Returns an unsubscribe function. Used by
   * the WebSocket handler — every message it receives is forwarded to the
   * subscriber until the WS closes.
   */
  subscribe(ptyId: string, cb: (data: string) => void): () => void {
    const handle = this.handles.get(ptyId);
    if (!handle) throw new Error("PTY not found");
    handle.subscribers.add(cb);
    return () => {
      handle.subscribers.delete(cb);
    };
  }

  /** Returns true if a PTY with this id is currently live. */
  has(ptyId: string): boolean {
    return this.handles.has(ptyId);
  }

  /**
   * Force-stop a single PTY. Called on WS close so the shell dies with the
   * browser tab. Idempotent — missing ids are no-ops.
   */
  stop(ptyId: string): void {
    const handle = this.handles.get(ptyId);
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
    this.handles.delete(ptyId);
  }

  /** Best-effort cleanup for SIGINT/SIGTERM. */
  stopAll(): void {
    for (const id of this.handles.keys()) this.stop(id);
  }
}

function shortPath(cwd: string): string {
  const home = getHomeDir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}