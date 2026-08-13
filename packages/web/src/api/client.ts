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
  SearchResult,
  SessionInfo,
  VersionInfo,
  ProjectBrowseResult,
} from "@pichamber/shared";

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
  }).then((r) => jsonOrThrow<{ sessionId: string; cwd: string }>(r));

export const deleteSession = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`, { method: "DELETE" }).then((r) =>
    jsonOrThrow<{ ok: true }>(r),
  );

export const browseProjectDirectories = (path?: string) => {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const query = params.toString();
  return fetch(`${BASE}/projects/browse${query ? `?${query}` : ""}`).then((r) =>
    jsonOrThrow<ProjectBrowseResult>(r),
  );
};

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

export const listDirectory = async (sessionId?: string | null, path?: string) => {
  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  if (path) params.set("path", path);
  const qs = params.toString();
  const url = qs ? `${BASE}/fs/list?${qs}` : `${BASE}/fs/list`;
  const r = await fetch(url);
  return await jsonOrThrow<ListResult>(r);
};

export const searchFiles = async (sessionId: string | null | undefined, query: string) => {
  const params = new URLSearchParams({ q: query });
  if (sessionId) params.set("sessionId", sessionId);
  const r = await fetch(`${BASE}/fs/search?${params}`);
  return await jsonOrThrow<SearchResult>(r);
};

// ─── Git (Git pane) ───────────────────────────────────────────────────

export const getGitStatus = (sessionId?: string | null) =>
  fetch(`${BASE}/git/status?sessionId=${encodeURIComponent(sessionId ?? "")}`).then((r) =>
    jsonOrThrow<GitStatus>(r),
  );

export const getGitDiff = (sessionId: string | null | undefined, path: string, staged: boolean) =>
  fetch(
    `${BASE}/git/diff?sessionId=${encodeURIComponent(sessionId ?? "")}&path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`,
  ).then((r) => jsonOrThrow<GitDiffResult>(r));

export const stageGitPaths = (sessionId: string | null | undefined, paths?: string[]) =>
  fetch(`${BASE}/git/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined, paths } satisfies GitStageRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const unstageGitPaths = (sessionId: string | null | undefined, paths: string[]) =>
  fetch(`${BASE}/git/unstage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined, paths } satisfies GitStageRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const commitGit = (sessionId: string | null | undefined, message: string) =>
  fetch(`${BASE}/git/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined, message } satisfies GitCommitRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));
