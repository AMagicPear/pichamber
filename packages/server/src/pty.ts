/** PTY sessions backed by bun-pty. */

import { statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawn, type IDisposable, type IPty } from "bun-pty";

import { getWorkspace, shortPath } from "./workspace";

export { shortPath };

export interface PtyHandle {
  id: string;
  terminal: IPty;
  outputSubscription: IDisposable;
  exitSubscription: IDisposable;
  subscribers: Set<(data: string) => void>;
  exitSubscribers: Set<() => void>;
  orphanTimer?: ReturnType<typeof setTimeout>;
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

const handles = new Map<string, PtyHandle>();
const ORPHAN_GRACE_MS = 5_000;

const getDefaultShell = (): string => {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === "win32") return process.env.COMSPEC ?? "cmd.exe";
  return "/bin/zsh";
};

const resolveCwd = (input: string | undefined): string => {
  const fallback = getWorkspace();
  if (!input) return fallback;
  const cwd = isAbsolute(input) ? input : resolve(process.cwd(), input);
  try {
    return statSync(cwd).isDirectory() ? cwd : fallback;
  } catch {
    return fallback;
  }
};

const getTerminalEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.LANG ||= process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8";
  env.LC_CTYPE ||= process.platform === "darwin" ? "UTF-8" : "C.UTF-8";
  delete env.BASH_XTRACEFD;
  delete env.BASH_ENV;
  delete env.ENV;
  return env;
};

const cancelOrphanStop = (handle: PtyHandle) => {
  if (handle.orphanTimer === undefined) return;
  clearTimeout(handle.orphanTimer);
  handle.orphanTimer = undefined;
};

const scheduleOrphanStop = (handle: PtyHandle) => {
  if (handle.orphanTimer !== undefined || handle.subscribers.size !== 0) return;
  handle.orphanTimer = setTimeout(() => {
    handle.orphanTimer = undefined;
    if (handle.subscribers.size === 0) stopPty(handle.id);
  }, ORPHAN_GRACE_MS);
};

export const hasPty = (ptyId: string): boolean => {
  return handles.has(ptyId);
};

export const startPty = (options: PtyStartOptions): PtyStartResult => {
  const cwd = resolveCwd(options.cwd);
  const shell = options.shell ?? getDefaultShell();
  const id = crypto.randomUUID();
  let handle: PtyHandle | undefined;

  const terminal = spawn(shell, [], {
    name: "xterm-256color",
    cols: Math.max(2, Math.floor(options.cols)),
    rows: Math.max(2, Math.floor(options.rows)),
    cwd,
    env: getTerminalEnv(),
  });

  const outputSubscription = terminal.onData((data) => {
    const current = handle;
    if (!current) return;
    for (const sub of current.subscribers) sub(data);
  });

  const exitSubscription = terminal.onExit(() => {
    const current = handles.get(id);
    if (!current) return;
    const subscribers = [...current.subscribers];
    const exitSubscribers = [...current.exitSubscribers];
    current.subscribers.clear();
    current.exitSubscribers.clear();
    current.outputSubscription.dispose();
    current.exitSubscription.dispose();
    handles.delete(id);
    for (const sub of subscribers) sub("\x1b[33mTerminal exited\x1b[0m\r\n");
    for (const sub of exitSubscribers) sub();
  });

  handle = {
    id,
    terminal,
    outputSubscription,
    exitSubscription,
    subscribers: new Set(),
    exitSubscribers: new Set(),
    shell,
    cwd,
    title: shortPath(cwd),
  };
  handles.set(id, handle);

  return { ptyId: id, shell, cwd, title: handle.title };
};

/** Push raw stdin bytes into the shell (keystrokes, pasted text, etc.). */
export const writePty = (ptyId: string, data: string) => {
  const handle = handles.get(ptyId);
  if (!handle) throw new Error("Terminal is not running");
  handle.terminal.write(data);
};

export const resizePty = (ptyId: string, cols: number, rows: number) => {
  const handle = handles.get(ptyId);
  if (!handle) throw new Error("Terminal is not running");
  handle.terminal.resize(Math.max(2, Math.floor(cols)), Math.max(2, Math.floor(rows)));
};

/** Register a sink for PTY output. */
export const subscribePty = (ptyId: string, cb: (data: string) => void): (() => void) => {
  const handle = handles.get(ptyId);
  if (!handle) throw new Error("PTY not found");
  cancelOrphanStop(handle);
  handle.subscribers.add(cb);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    handle.subscribers.delete(cb);
    scheduleOrphanStop(handle);
  };
};

/** Register a callback for the PTY's natural exit. */
export const subscribePtyExit = (ptyId: string, cb: () => void): (() => void) => {
  const handle = handles.get(ptyId);
  if (!handle) throw new Error("PTY not found");
  handle.exitSubscribers.add(cb);
  return () => handle.exitSubscribers.delete(cb);
};

/** Explicitly terminate a tab-owned PTY. Idempotent for missing ids. */
export const stopPty = (ptyId: string) => {
  const handle = handles.get(ptyId);
  if (!handle) return;
  cancelOrphanStop(handle);
  handles.delete(ptyId);
  handle.subscribers.clear();
  handle.exitSubscribers.clear();
  handle.outputSubscription.dispose();
  handle.exitSubscription.dispose();
  try {
    handle.terminal.kill();
  } catch {
    /* already exited */
  }
};

export const stopAllPtys = () => {
  for (const id of handles.keys()) stopPty(id);
};
