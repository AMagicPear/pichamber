// REST client — every request goes through Vite's `/api` proxy to the
// Bun server on :3000. The single `jsonOrThrow` helper centralises error
// handling so each call site is a one-liner.

import type {
  GitBranchList,
  GitCheckoutRequest,
  GitCommitRequest,
  GitDiffResult,
  GitSessionRequest,
  GitStageRequest,
  GitStashList,
  GitStashPushRequest,
  GitStashRefRequest,
  GitStatus,
  ListResult,
  OpenFileResult,
  ProviderQuota,
  ProviderDescriptor,
  PiBehaviorSettings,
  PiBuiltinExtension,
  PiExtensionSource,
  PiExtensionUpdate,
  PiProviderSettings,
  ExtensionsOverview,
  SkillsOverview,
  McpOverview,
  PtyStartOptions,
  PtyStartResult,
  SearchResult,
  SessionInfo,
  VersionInfo,
  ProjectBrowseResult,
} from "@amagicpear/pichamber-shared";

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

/** Append an optional `sessionId` query param. Omitted entirely when the
 *  session id is falsy — a bare `sessionId=` is meaningless to the server,
 *  and every GET helper across the client shares one rule. */
const withSessionId = (params: URLSearchParams, sessionId?: string | null): string => {
  if (sessionId) params.set("sessionId", sessionId);
  return params.toString();
};

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

export const forkSession = (sessionId: string, entryId: string) =>
  fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/fork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entryId }),
  }).then((r) => jsonOrThrow<{ sessionId: string; cwd: string }>(r));

export const copySession = (sessionId: string, cwd: string) =>
  fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  }).then((r) => jsonOrThrow<{ sessionId: string; cwd: string }>(r));

export const deleteSession = (sessionId: string) =>
  fetch(`${BASE}/sessions/${sessionId}`, { method: "DELETE" }).then((r) =>
    jsonOrThrow<{ ok: true }>(r),
  );

export const renameSession = (sessionId: string, name: string) =>
  fetch(`${BASE}/sessions/${sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((r) => jsonOrThrow<{ ok: true }>(r));

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
  if (path) params.set("path", path);
  const query = withSessionId(params, sessionId);
  const url = query ? `${BASE}/fs/list?${query}` : `${BASE}/fs/list`;
  const r = await fetch(url);
  return await jsonOrThrow<ListResult>(r);
};

export const searchFiles = async (sessionId: string | null | undefined, query: string) => {
  const params = new URLSearchParams({ q: query });
  const qs = withSessionId(params, sessionId);
  const r = await fetch(`${BASE}/fs/search?${qs}`);
  return await jsonOrThrow<SearchResult>(r);
};

export const openFile = async (sessionId: string | null | undefined, path: string) => {
  const params = new URLSearchParams({ path });
  const qs = withSessionId(params, sessionId);
  const r = await fetch(`${BASE}/fs/open?${qs}`);
  return await jsonOrThrow<OpenFileResult>(r);
};

export type FileEditor = "vscode" | "cursor" | "zed" | "webstorm" | "system";
export const fetchFileEditor = () => fetch(`${BASE}/settings/editor`).then((r) => jsonOrThrow<{ fileEditor: FileEditor }>(r));
export const updateFileEditor = (fileEditor: FileEditor) =>
  fetch(`${BASE}/settings/editor`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileEditor }) })
    .then((r) => jsonOrThrow<{ fileEditor: FileEditor }>(r));

// ─── Git (Git pane) ───────────────────────────────────────────────────

export const getGitStatus = (sessionId?: string | null) =>
  fetch(`${BASE}/git/status?${withSessionId(new URLSearchParams(), sessionId)}`).then((r) =>
    jsonOrThrow<GitStatus>(r),
  );

export const getGitDiff = (sessionId: string | null | undefined, path: string, staged: boolean) => {
  const params = new URLSearchParams({ path, staged: staged ? "1" : "0" });
  const query = withSessionId(params, sessionId);
  return fetch(`${BASE}/git/diff?${query}`).then((r) => jsonOrThrow<GitDiffResult>(r));
};

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

export const initGitRepo = (sessionId?: string | null) =>
  fetch(`${BASE}/git/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined } satisfies GitSessionRequest),
  }).then((r) => jsonOrThrow<GitStatus>(r));

export const discardGitPaths = (sessionId: string | null | undefined, paths: string[]) =>
  fetch(`${BASE}/git/discard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined, paths } satisfies GitStageRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const listGitBranches = (sessionId?: string | null) =>
  fetch(`${BASE}/git/branches?${withSessionId(new URLSearchParams(), sessionId)}`).then((r) =>
    jsonOrThrow<GitBranchList>(r),
  );

export const checkoutGitBranch = (sessionId: string | null | undefined, branch: string) =>
  fetch(`${BASE}/git/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined, branch } satisfies GitCheckoutRequest),
  }).then((r) => jsonOrThrow<GitStatus>(r));

export const pushGit = (sessionId?: string | null) =>
  fetch(`${BASE}/git/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined } satisfies GitSessionRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const pullGit = (sessionId?: string | null) =>
  fetch(`${BASE}/git/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined } satisfies GitSessionRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const fetchGit = (sessionId?: string | null) =>
  fetch(`${BASE}/git/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined } satisfies GitSessionRequest),
  }).then((r) => jsonOrThrow<{ ok: boolean }>(r));

export const listGitStashes = (sessionId?: string | null) =>
  fetch(`${BASE}/git/stashes?${withSessionId(new URLSearchParams(), sessionId)}`).then((r) =>
    jsonOrThrow<GitStashList>(r),
  );

export const pushGitStash = (sessionId: string | null | undefined, message?: string, includeUntracked = true) =>
  fetch(`${BASE}/git/stash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionId ?? undefined,
      message,
      includeUntracked,
    } satisfies GitStashPushRequest),
  }).then((r) => jsonOrThrow<GitStashList>(r));

export const popGitStash = (sessionId?: string | null) =>
  fetch(`${BASE}/git/stash/pop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined } satisfies GitSessionRequest),
  }).then((r) => jsonOrThrow<GitStashList>(r));

export const dropGitStash = (sessionId: string | null | undefined, index: number) =>
  fetch(`${BASE}/git/stash/drop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sessionId ?? undefined, index } satisfies GitStashRefRequest),
  }).then((r) => jsonOrThrow<GitStashList>(r));

// ─── Provider quotas ─────────────────────────────────────────────────

export const fetchQuotaProviders = (sessionId: string) =>
  fetch(`${BASE}/quota/providers?sessionId=${encodeURIComponent(sessionId)}`).then((r) =>
    jsonOrThrow<{ providers: ProviderDescriptor[] }>(r),
  );

export const fetchProviderQuota = (sessionId: string, provider: string) =>
  fetch(`${BASE}/quota/${encodeURIComponent(provider)}?sessionId=${encodeURIComponent(sessionId)}`).then(
    (r) => jsonOrThrow<ProviderQuota>(r),
  );

// ─── Diagnostics ───────────────────────────────────────────────────────────────
// Local-only. The browser pulls a bounded JSONL tail from the server and
// merges it with its own IndexedDB ring; nothing leaves the device unless
// the user attaches the export to a bug report.

export type DiagnosticsServerResponse = {
  directory: string;
  events: Array<{ v: 1; ts: string; level: string; scope: string; msg: string; [key: string]: unknown }>;
  error?: string;
};

export const fetchDiagnosticsServer = (tail = 500) =>
  fetch(`/api/diagnostics/server?tail=${encodeURIComponent(String(tail))}`).then((r) => jsonOrThrow<DiagnosticsServerResponse>(r));

// ─── Pi SDK configuration ───────────────────────────────────────────

export const fetchPiProviders = (sessionId: string) =>
  fetch(`${BASE}/pi/providers?sessionId=${encodeURIComponent(sessionId)}`).then((r) =>
    jsonOrThrow<{ providers: PiProviderSettings[] }>(r),
  );

export const setPiProviderApiKey = (sessionId: string, provider: string, apiKey: string) =>
  fetch(`${BASE}/pi/providers/${encodeURIComponent(provider)}/credential?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  }).then((r) => jsonOrThrow<{ providers: PiProviderSettings[] }>(r));

export const removePiProviderCredential = (sessionId: string, provider: string) =>
  fetch(`${BASE}/pi/providers/${encodeURIComponent(provider)}/credential?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  }).then((r) => jsonOrThrow<{ providers: PiProviderSettings[] }>(r));

export const fetchPiBehavior = (sessionId: string) =>
  fetch(`${BASE}/pi/behavior?sessionId=${encodeURIComponent(sessionId)}`).then((r) =>
    jsonOrThrow<PiBehaviorSettings>(r),
  );

export const updatePiBehavior = (sessionId: string, next: Partial<PiBehaviorSettings>) =>
  fetch(`${BASE}/pi/behavior?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  }).then((r) => jsonOrThrow<PiBehaviorSettings & { reload?: boolean }>(r));

export const fetchExecutionBackend = () =>
  fetch(`${BASE}/settings/execution-backend`).then((r) => jsonOrThrow<{ executionBackend: "sdk" | "rpc" }>(r));

export const updateExecutionBackend = (executionBackend: "sdk" | "rpc") =>
  fetch(`${BASE}/settings/execution-backend`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ executionBackend }),
  }).then((r) => jsonOrThrow<{ executionBackend: "sdk" | "rpc"; reload: boolean }>(r));

export const fetchPiExtensionSources = (sessionId: string) =>
  fetch(`${BASE}/pi/extensions?sessionId=${encodeURIComponent(sessionId)}`).then((r) =>
    jsonOrThrow<{ sources: PiExtensionSource[] }>(r),
  );

export const installPiExtensionSource = (
  sessionId: string,
  source: string,
  scope: "user" | "project",
) =>
  fetch(`${BASE}/pi/extensions?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, scope }),
  }).then((r) => jsonOrThrow<{ sources: PiExtensionSource[] }>(r));

export const removePiExtensionSource = (
  sessionId: string,
  source: string,
  scope: "user" | "project",
) =>
  fetch(`${BASE}/pi/extensions?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, scope }),
  }).then((r) => jsonOrThrow<{ sources: PiExtensionSource[] }>(r));

export const fetchPiBuiltinExtensions = () =>
  fetch(`${BASE}/pi/extensions/builtins`).then((r) =>
    jsonOrThrow<{ builtins: PiBuiltinExtension[] }>(r),
  );

export const setPiBuiltinExtension = (sessionId: string, id: string, install: boolean) =>
  fetch(`${BASE}/pi/extensions/builtins/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ install }),
  }).then((r) => jsonOrThrow<{ builtins: PiBuiltinExtension[] }>(r));

/** Unified snapshot: pichamber built-ins + Pi package sources + currently loaded extensions. */
export const fetchPiExtensionsOverview = (sessionId: string) =>
  fetch(`${BASE}/pi/extensions/overview?sessionId=${encodeURIComponent(sessionId)}`).then((r) =>
    jsonOrThrow<ExtensionsOverview>(r),
  );

export const checkPiExtensionUpdates = (sessionId: string) =>
  fetch(`${BASE}/pi/extensions/updates?sessionId=${encodeURIComponent(sessionId)}`).then((r) =>
    jsonOrThrow<{ updates: PiExtensionUpdate[] }>(r),
  );

export const updatePiExtensions = (sessionId: string, source?: string) =>
  fetch(`${BASE}/pi/extensions/updates?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(source ? { source } : {}),
  }).then((r) => jsonOrThrow<{ updates: PiExtensionUpdate[] }>(r));

export const fetchPiSkillsOverview = (sessionId: string) =>
  fetch(`${BASE}/pi/skills/overview?sessionId=${encodeURIComponent(sessionId)}`).then((r) =>
    jsonOrThrow<SkillsOverview>(r),
  );

export const setPiSkillEnabled = (sessionId: string, path: string, enabled: boolean) =>
  fetch(`${BASE}/pi/skills/enabled?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, enabled }),
  }).then((r) => jsonOrThrow<{ enabled: boolean }>(r));

export const setPiSkillCommands = (sessionId: string, enabled: boolean) =>
  fetch(`${BASE}/pi/skills/commands?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }).then((r) => jsonOrThrow<{ enabled: boolean }>(r));

export const fetchPiMcpOverview = (sessionId: string) =>
  fetch(`${BASE}/pi/mcp/overview?sessionId=${encodeURIComponent(sessionId)}`).then((r) => jsonOrThrow<McpOverview>(r));

export const setPiMcpServerEnabled = (sessionId: string, name: string, enabled: boolean) =>
  fetch(`${BASE}/pi/mcp/${encodeURIComponent(name)}/enabled?sessionId=${encodeURIComponent(sessionId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }).then((r) => jsonOrThrow<McpOverview>(r));

export const reconnectPiMcpServer = (sessionId: string, name: string) =>
  fetch(`${BASE}/pi/mcp/${encodeURIComponent(name)}/reconnect?sessionId=${encodeURIComponent(sessionId)}`, { method: "POST" }).then((r) => jsonOrThrow<McpOverview>(r));
