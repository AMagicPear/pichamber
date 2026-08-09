// REST client — every request goes through Vite's `/api` proxy to the
// Bun server on :3000. The single `jsonOrThrow` helper centralises error
// handling so each call site is a one-liner.

import type {
  GitCommitRequest,
  GitDiffResult,
  GitStageRequest,
  GitStatus,
  ListResult,
  PtyStartOptions,
  PtyStartResult,
  SessionEntry,
  SessionInfo,
  VersionInfo,
} from "@pichamber/shared";
import { workspace } from "@/stores/workspace";

const BASE = "/api";

const jsonOrThrow = async <T>(res: Response): Promise<T> => {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    const message =
      typeof data?.error === "string" ? data.error : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
};

// `catch` variables are `unknown` since TS 4.0. Every throw in this codebase
// is an `Error`, so this narrowing is the single conversion site.
export const toMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─── AI sessions ──────────────────────────────────────────────────────

export const listSessions = () =>
  fetch(`${BASE}/sessions`).then((r) => jsonOrThrow<SessionInfo[]>(r));

export const getVersion = () => fetch(`${BASE}/version`).then((r) => jsonOrThrow<VersionInfo>(r));

export const createSession = (cwd: string) =>
  fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  }).then((r) => jsonOrThrow<{ sessionId: string }>(r));

export const getEntries = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`).then((r) => jsonOrThrow<SessionEntry[]>(r));

export const deleteSession = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`, { method: "DELETE" }).then((r) =>
    jsonOrThrow<{ ok: true }>(r),
  );

// ─── Terminal (PTY) ───────────────────────────────────────────────────

export const startPty = (options: PtyStartOptions) =>
  fetch(`${BASE}/pty/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  }).then((r) => jsonOrThrow<PtyStartResult>(r));

export const stopPty = (ptyId: string) =>
  fetch(`${BASE}/pty/${encodeURIComponent(ptyId)}`, { method: "DELETE" }).then((r) =>
    jsonOrThrow<{ ok: true }>(r),
  );

// ─── Filesystem (files panel) ────────────────────────────────────────

export const listDirectory = async (path?: string) => {
  const url = path ? `${BASE}/fs/list?path=${encodeURIComponent(path)}` : `${BASE}/fs/list`;
  const r = await fetch(url);
  return await jsonOrThrow<ListResult>(r);
};

// ─── Git (Git pane) ───────────────────────────────────────────────────

/** Session workspace root, like FileTree: "~" means the server default. */
export const gitCwd = () => (workspace.cwd && workspace.cwd !== "~" ? workspace.cwd : undefined);

export const getGitStatus = () =>
  fetch(`${BASE}/git/status?cwd=${encodeURIComponent(gitCwd() ?? "")}`).then((r) =>
    jsonOrThrow<GitStatus>(r),
  );

export const getGitDiff = (path: string, staged: boolean) =>
  fetch(
    `${BASE}/git/diff?cwd=${encodeURIComponent(gitCwd() ?? "")}&path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`,
  ).then((r) => jsonOrThrow<GitDiffResult>(r));

export const stageGitPaths = (paths?: string[]) =>
  fetch(`${BASE}/git/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: gitCwd(), paths } satisfies GitStageRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const unstageGitPaths = (paths: string[]) =>
  fetch(`${BASE}/git/unstage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: gitCwd(), paths } satisfies GitStageRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const commitGit = (message: string) =>
  fetch(`${BASE}/git/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: gitCwd(), message } satisfies GitCommitRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));
