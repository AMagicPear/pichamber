import { basename, dirname, join } from "node:path";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { listDirectory, openFile, searchFiles } from "./services/fs";
import {
  checkout,
  commit,
  discardPaths,
  fetchRemotes,
  getDiff,
  getStatus,
  init,
  listBranches,
  listStashes,
  pull,
  push,
  stagePaths,
  stash,
  stashDrop,
  stashPop,
  unstagePaths,
} from "./services/git";
import {
  createSessionWithCwd,
  deleteSession,
  getSessionCwd,
  listAllSessions,
  renameSession,
} from "./core/session";
import {
  hasPty,
  resizePty,
  startPty,
  stopAllPtys,
  stopPty,
  subscribePty,
  subscribePtyExit,
  writePty,
} from "./services/pty";
import { closeSessionSockets, sessionWsHandler } from "./core/ws";
import { refreshSessionModelState } from "./core/ws";
import { type PtyWsData, type SessionWsData, type WsData, type WsHandler } from "./core/ws";
import { browseProjectDirectories } from "./services/projects";
import { getProviderQuota, listQuotaProviders } from "./providers/quota";
import { getSession } from "./core/session";
import { toMessage } from "./error";
import { canonicalWorkspace, getWorkspace, WorkspaceError } from "./services/workspace";
import type { ExtensionsOverview, LoadedExtensionInfo } from "@amagicpear/pichamber-shared";
import {
  getPiBehaviorSettings,
  listPiProviders,
  removePiProviderCredential,
  setPiProviderApiKey,
  updatePiBehaviorSettings,
} from "./settings/pi-config";
import {
  checkPiExtensionUpdates,
  installPiExtensionSource,
  listPiExtensionSources,
  removePiExtensionSource,
  updatePiExtensions,
} from "./extensions/pi-extensions";
import {
  getBuiltinExtension,
  installBuiltinExtension,
  installedExtensionPath,
  listBuiltinExtensions,
  removeBuiltinExtension,
} from "./extensions/builtin-extensions";

const hostname = process.env.PICHAMBER_HOST || "127.0.0.1";
const configuredPort = Number(process.env.PICHAMBER_PORT || 3000);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error(`Invalid PICHAMBER_PORT: ${process.env.PICHAMBER_PORT}`);
}
const version = process.env.PICHAMBER_VERSION || "dev";
const instanceId = process.env.PICHAMBER_INSTANCE_ID;
const daemonToken = process.env.PICHAMBER_DAEMON_TOKEN;
const startedAt = new Date().toISOString();

// ─── WebSocket protocol multiplexing ───────────────────────────────────
//
// Bun's `websocket` callbacks receive (ws, message) — the data payload is
// always reachable via `ws.data`. We use that: at upgrade time we attach
// the matching handler to `ws.data.handler`, and the multiplex code below
// just forwards. Adding a new protocol means writing one `WsHandler` and
// attaching it on upgrade — no edits to the multiplex code. The protocol
// types (`WsHandler`, `PtyWsData`, `SessionWsData`, `WsData`) live in
// `ws.ts`, which owns the WS protocol surface.
/** Map a filesystem error to an HTTP response. */
const fsErrorResponse = (err: unknown): Response => {
  if (err instanceof WorkspaceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === "ENOENT") return Response.json({ error: "Not found" }, { status: 404 });
  if (code === "EACCES") return Response.json({ error: "Permission denied" }, { status: 403 });
  const message = toMessage(err);
  console.error("Filesystem operation failed:", err);
  return Response.json({ error: message }, { status: 500 });
};

const requestCwd = async (sessionId?: string | null) => {
  if (!sessionId) return getWorkspace();
  const cwd = await getSessionCwd(sessionId);
  if (!cwd) throw new WorkspaceError("Session not found", 404);
  return canonicalWorkspace(cwd);
};

const getSdkSession = async (sessionId: string) => {
  const runtime = await getSession(sessionId);
  if (!runtime) return { error: "session not found", status: 404 } as const;
  return { session: runtime.session, cwd: runtime.services.cwd } as const;
};

const ptyWsHandler: WsHandler = {
  open(ws) {
    const data = ws.data as PtyWsData;
    // Subscribe the WS to PTY output. Stash the unsub on ws.data so close
    // can release it.
    const unsubOutput = subscribePty(data.ptyId, (chunk) => {
      if (ws.readyState === 1) ws.send(chunk);
    });
    const unsubExit = subscribePtyExit(data.ptyId, () => {
      if (ws.readyState === 1) ws.close(1000, "PTY exited");
    });
    data.unsub = () => {
      unsubOutput();
      unsubExit();
    };
  },
  message(ws, message) {
    const data = ws.data as PtyWsData;
    const text = typeof message === "string" ? message : message.toString();
    try {
      // A JSON object = control frame (resize). Anything else = stdin.
      if (text.startsWith("{")) {
        const ctrl = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
        if (
          ctrl.type === "resize" &&
          typeof ctrl.cols === "number" &&
          typeof ctrl.rows === "number"
        ) {
          resizePty(data.ptyId, ctrl.cols, ctrl.rows);
          return;
        }
      }
      writePty(data.ptyId, text);
    } catch (err) {
      ws.close(1011, toMessage(err));
    }
  },
  close(ws) {
    const data = ws.data as PtyWsData;
    data.unsub?.();
  },
};

// ─── HTTP + WebSocket server ───────────────────────────────────────────

const server = Bun.serve({
  hostname,
  port: configuredPort,
  routes: {
    "/api/health": {
      GET: () =>
        Response.json({
          ok: true,
          app: "pichamber",
          version,
          pi: PI_VERSION,
          pid: process.pid,
          startedAt,
          instanceId,
        }),
    },
    "/api/version": {
      GET: () => Response.json({ pi: PI_VERSION }),
    },
    "/api/sessions": {
      GET: async () => {
        const sessions = await listAllSessions();
        return Response.json(
          await Promise.all(
            sessions.map(async (session) => ({
              ...session,
              cwd: await canonicalWorkspace(session.cwd).catch(() => session.cwd),
            })),
          ),
        );
      },
      POST: async (req) => {
        const { cwd } = (await req.json()) as { cwd: string };
        const workspace = await canonicalWorkspace(cwd);
        const runtime = await createSessionWithCwd(workspace);
        return Response.json({
          sessionId: runtime.session.sessionId,
          cwd: workspace,
          sessionFile: runtime.session.sessionFile,
          tools: runtime.session.getActiveToolNames(),
        });
      },
    },
    "/api/pi/providers": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ providers: listPiProviders(result.session) });
      },
    },
    "/api/pi/providers/:provider/credential": {
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { apiKey?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
          return Response.json({ error: "apiKey required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const providers = await setPiProviderApiKey(result.session, req.params.provider, body.apiKey.trim());
          refreshSessionModelState(sessionId);
          return Response.json({ providers });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
      DELETE: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const providers = await removePiProviderCredential(result.session, req.params.provider);
          refreshSessionModelState(sessionId);
          return Response.json({ providers });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/behavior": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json(getPiBehaviorSettings(result.session));
      },
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const update = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          return Response.json(await updatePiBehaviorSettings(result.session, update));
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/extensions": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ sources: listPiExtensionSources(result.session, result.cwd) });
      },
      POST: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { source?: unknown; scope?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.source !== "string" || !body.source.trim()) {
          return Response.json({ error: "source required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const sources = await installPiExtensionSource(result.session, result.cwd, body.source.trim(), body.scope === "project");
          return Response.json({ sources });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
      DELETE: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { source?: unknown; scope?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.source !== "string" || !body.source.trim()) {
          return Response.json({ error: "source required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const sources = await removePiExtensionSource(result.session, result.cwd, body.source.trim(), body.scope === "project");
          return Response.json({ sources });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/extensions/overview": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const runtime = await getSession(sessionId);
          if (!runtime) return Response.json({ error: "session not found" }, { status: 404 });
          const resources = runtime.session.resourceLoader.getExtensions();
          const sources = listPiExtensionSources(runtime.session, runtime.services.cwd);
          const builtins = listBuiltinExtensions();
          const overview: ExtensionsOverview = {
            builtins,
            sources,
            loaded: resources.extensions.map((e) => {
              const builtinMatch = builtins.find(
                (b) => e.path === installedExtensionPath(b.id) || e.path.startsWith(`${installedExtensionPath(b.id)}/`),
              );
              const entry: LoadedExtensionInfo = {
                label: builtinMatch?.name ?? (e.sourceInfo.source === "auto" ? basename(dirname(e.path)) : e.sourceInfo.source),
                path: e.path,
                source: e.sourceInfo.source,
                scope: e.sourceInfo.scope,
                origin: e.sourceInfo.origin,
                commands: [...e.commands.keys()],
                tools: [...e.tools.keys()],
              };
              if (builtinMatch) entry.builtinId = builtinMatch.id;
              return entry;
            }),
            diagnostics: resources.errors,
            inventoryAvailable: true,
          };
          return Response.json(overview);
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/extensions/updates": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          return Response.json({ updates: await checkPiExtensionUpdates(result.session, result.cwd) });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
      POST: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { source?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (body.source !== undefined && typeof body.source !== "string") {
          return Response.json({ error: "source must be a string" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          await updatePiExtensions(result.session, result.cwd, body.source?.trim() || undefined);
          await result.session.reload();
          return Response.json({ updates: await checkPiExtensionUpdates(result.session, result.cwd) });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/extensions/builtins": {
      GET: () => Response.json({ builtins: listBuiltinExtensions() }),
    },
    "/api/pi/extensions/builtins/:id": {
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const body = (await req.json().catch(() => ({}))) as { install?: unknown };
        if (typeof body.install !== "boolean") {
          return Response.json({ error: "install (boolean) required" }, { status: 400 });
        }
        try {
          const def = getBuiltinExtension(req.params.id);
          if (body.install) installBuiltinExtension(def);
          else removeBuiltinExtension(def);

          // 配置后重新加载当前 SDK 会话，让新扩展立即生效并刷新资源快照。
          const result = await getSdkSession(sessionId);
          if ("error" in result) {
            return Response.json({ builtins: listBuiltinExtensions() });
          }
          await result.session.reload();
          return Response.json({ builtins: listBuiltinExtensions() });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/sessions/:id": {
      DELETE: async (req) => {
        await closeSessionSockets(req.params.id);
        const result = await deleteSession(req.params.id);
        if (!result.ok) return Response.json({ error: "session not found" }, { status: 404 });
        return Response.json(result);
      },
      PUT: async (req) => {
        const { name } = (await req.json()) as { name?: string };
        const trimmed = name?.trim() ?? "";
        if (!trimmed) {
          return Response.json({ error: "name required" }, { status: 400 });
        }
        const ok = await renameSession(req.params.id, trimmed);
        if (!ok) return Response.json({ error: "session not found" }, { status: 404 });
        return Response.json({ ok: true });
      },
    },
    "/api/projects/browse": {
      GET: async (req) => {
        try {
          return Response.json(
            await browseProjectDirectories(new URL(req.url).searchParams.get("path")),
          );
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/quota/providers": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const runtime = await getSession(sessionId);
        if (!runtime) return Response.json({ error: "session not found" }, { status: 404 });
        return Response.json({ providers: listQuotaProviders(runtime.session) });
      },
    },
    "/api/quota/:provider": {
      GET: async (req) => {
        const provider = req.params.provider;
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) {
          return Response.json({ error: "sessionId required" }, { status: 400 });
        }
        try {
          const runtime = await getSession(sessionId);
          if (!runtime) return Response.json({ error: "session not found" }, { status: 404 });
          return Response.json(await getProviderQuota(provider, runtime.session));
        } catch (err) {
          return Response.json({ error: toMessage(err) }, { status: 500 });
        }
      },
    },
    "/api/daemon/shutdown": {
      POST: (req) => {
        if (!daemonToken || req.headers.get("Authorization") !== `Bearer ${daemonToken}`) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        setTimeout(shutdown, 0);
        return Response.json({ ok: true });
      },
    },

    // ── Terminal (PTY) ─────────────────────────────────────────────
    // Spawn a real shell. Returns { ptyId, shell, cwd, title }. The
    // client then opens a WebSocket on /ws/pty/:ptyId to drive it.
    "/api/pty/start": {
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as {
          sessionId?: string;
          cols?: number;
          rows?: number;
        };
        try {
          const cwd = await requestCwd(body.sessionId);
          return Response.json(
            startPty({
              cwd,
              cols: body.cols ?? 80,
              rows: body.rows ?? 24,
            }),
          );
        } catch (err) {
          const message = toMessage(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
    "/api/pty/:id": {
      DELETE: (req) => {
        stopPty(req.params.id);
        return Response.json({ ok: true });
      },
    },

    // ── Git (Git pane) ──────────────────────────────────────────
    // All commands run inside the active workspace; paths are
    // workspace-relative. Not a git repository → 400 with git's message.
    "/api/git/status": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json(await getStatus(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/diff": {
      GET: async (req) => {
        const url = new URL(req.url);
        const sessionId = url.searchParams.get("sessionId");
        const path = url.searchParams.get("path") ?? "";
        const staged = url.searchParams.get("staged") === "1";
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json({ diff: await getDiff(cwd, path, staged) });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stage": {
      POST: async (req) => {
        const { sessionId, paths } = (await req.json().catch(() => ({}))) as { sessionId?: string; paths?: string[] };
        try {
          const cwd = await requestCwd(sessionId);
          await stagePaths(cwd, paths);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/unstage": {
      POST: async (req) => {
        const { sessionId, paths } = (await req.json().catch(() => ({}))) as { sessionId?: string; paths?: string[] };
        try {
          const cwd = await requestCwd(sessionId);
          await unstagePaths(cwd, paths ?? []);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/commit": {
      POST: async (req) => {
        const { sessionId, message } = (await req.json().catch(() => ({}))) as { sessionId?: string; message?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await commit(cwd, message ?? "");
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/discard": {
      POST: async (req) => {
        const { sessionId, paths } = (await req.json().catch(() => ({}))) as { sessionId?: string; paths?: string[] };
        try {
          const cwd = await requestCwd(sessionId);
          await discardPaths(cwd, paths ?? []);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/init": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await init(cwd);
          return Response.json(await getStatus(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/branches": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json(await listBranches(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/checkout": {
      POST: async (req) => {
        const { sessionId, branch } = (await req.json().catch(() => ({}))) as { sessionId?: string; branch?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await checkout(cwd, branch ?? "");
          return Response.json(await getStatus(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/push": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await push(cwd);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/pull": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await pull(cwd);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/fetch": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          await fetchRemotes(await requestCwd(sessionId));
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stashes": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stash": {
      POST: async (req) => {
        const { sessionId, message, includeUntracked } = (await req.json().catch(() => ({}))) as {
          sessionId?: string;
          message?: string;
          includeUntracked?: boolean;
        };
        try {
          const cwd = await requestCwd(sessionId);
          await stash(cwd, message, includeUntracked !== false);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stash/pop": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await stashPop(cwd);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stash/drop": {
      POST: async (req) => {
        const { sessionId, index } = (await req.json().catch(() => ({}))) as { sessionId?: string; index?: number };
        try {
          const cwd = await requestCwd(sessionId);
          await stashDrop(cwd, index ?? -1);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },

    // ── Filesystem (files panel) ─────────────────────────────────
    // The server resolves the active workspace from sessionId. Paths may be
    // absolute or workspace-relative; canonical paths outside it are rejected.
    // `/api/fs/open` is the one exception: it opens whatever path it's given
    // (relative to the workspace, `~/…`, or absolute), like the terminal.
    "/api/fs/list": {
      GET: async (req) => {
        const url = new URL(req.url);
        const path = url.searchParams.get("path") ?? undefined;
        const sessionId = url.searchParams.get("sessionId");
        try {
          return Response.json(await listDirectory(path, await requestCwd(sessionId)));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/fs/search": {
      GET: async (req) => {
        const url = new URL(req.url);
        const q = url.searchParams.get("q") ?? "";
        const sessionId = url.searchParams.get("sessionId");
        try {
          return Response.json({ entries: await searchFiles(q, 60, await requestCwd(sessionId)) });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/fs/open": {
      GET: async (req) => {
        const url = new URL(req.url);
        const path = url.searchParams.get("path") ?? "";
        const sessionId = url.searchParams.get("sessionId");
        if (!path) return Response.json({ error: "path is required" }, { status: 400 });
        try {
          return Response.json(await openFile(path, await requestCwd(sessionId)));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url);

    // PTY WebSocket — /ws/pty/:ptyId. Checked first so it doesn't get
    // eaten by the generic /ws/:sessionId match below.
    const ptyMatch = url.pathname.match(/^\/ws\/pty\/([^/]+)$/);
    if (ptyMatch) {
      const ptyId = ptyMatch[1]!;
      if (!hasPty(ptyId)) {
        return new Response("PTY not found", { status: 404 });
      }
      const data: PtyWsData = { protocol: "pty", ptyId, handler: ptyWsHandler };
      const success = server.upgrade(req, { data });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // AI session WebSocket — /ws/:sessionId.
    const sessionMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (sessionMatch) {
      const data: SessionWsData = {
        protocol: "session",
        sessionId: sessionMatch[1]!,
        handler: sessionWsHandler,
      };
      const success = server.upgrade(req, { data });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // ── Static web app (production) ─────────────────────────────
    // Serve the built SPA from `packages/web/dist`. Dev uses Vite instead.
    const webRoot = join(import.meta.dir, "..", "..", "web", "dist");
    const webIndex = Bun.file(join(webRoot, "index.html"));

    const serveWeb = async (url: URL): Promise<Response | null> => {
      if (!(await webIndex.exists())) return null;
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(join(webRoot, pathname));
      if (await file.exists()) return new Response(file);
      // SPA fallback: any unknown path serves the app shell.
      return new Response(webIndex, { headers: { "Content-Type": "text/html" } });
    };

    if (req.method === "GET" || req.method === "HEAD") {
      const web = await serveWeb(url);
      if (web) return web;
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    // `data` here declares the ws.data type for the callbacks below.
    data: {} as WsData,
    async open(ws) {
      await ws.data.handler.open(ws);
    },
    async message(ws, message) {
      await ws.data.handler.message(ws, message);
    },
    close(ws) {
      ws.data.handler.close(ws);
    },
  },
});

console.log(`Pichamber ${version} listening on http://${hostname}:${configuredPort}`);

// Best-effort cleanup on shutdown. Useful when Bun restarts in --hot mode.
const shutdown = () => {
  stopAllPtys();
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
