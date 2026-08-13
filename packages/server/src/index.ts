import type { ServerWebSocket } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { listDirectory, searchFiles, WorkspaceError } from "./fs";
import { commit, getDiff, getStatus, stagePaths, unstagePaths } from "./git";
import {
  createSessionWithCwd,
  deleteSession,
  getConversationEntries,
  getSession,
  listAllSessions,
} from "./session";
import {
  hasPty,
  resizePty,
  startPty,
  stopAllPtys,
  stopPty,
  subscribePty,
  subscribePtyExit,
  writePty,
} from "./pty";
import { closeSessionSockets, sessionWsHandler } from "./ws";
import { toMessage } from "./error";

// ─── WebSocket protocol multiplexing ───────────────────────────────────
//
// Bun's `websocket` callbacks receive (ws, message) — the data payload is
// always reachable via `ws.data`. We use that: at upgrade time we attach
// the matching handler to `ws.data.handler`, and the multiplex code below
// just forwards. Adding a new protocol means writing one `WsHandler` and
// attaching it on upgrade — no edits to the multiplex code.

export type WsHandler = {
  open(ws: ServerWebSocket<WsData>): void | Promise<void>;
  message(ws: ServerWebSocket<WsData>, message: string | Buffer): void | Promise<void>;
  close(ws: ServerWebSocket<WsData>): void;
};

// PTY data: the protocol tag + handler + the ptyId open/close need.
export type PtyWsData = {
  protocol: "pty";
  handler: WsHandler;
  ptyId: string;
  unsub?: () => void;
};

// AI session data: the protocol tag + handler + the sessionId.
export type SessionWsData = {
  protocol: "session";
  handler: WsHandler;
  sessionId: string;
  closed?: boolean;
  attached?: boolean;
};

export type WsData = PtyWsData | SessionWsData;

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

Bun.serve({
  port: 3000,
  routes: {
    "/api/health": {
      GET: () => Response.json({ ok: true }),
    },
    "/api/version": {
      GET: () => Response.json({ pi: PI_VERSION }),
    },
    "/api/sessions": {
      GET: async () => Response.json(await listAllSessions()),
      POST: async (req) => {
        const { cwd } = (await req.json()) as { cwd: string };
        const session = await createSessionWithCwd(cwd);
        return Response.json({
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
          tools: session.getActiveToolNames(),
        });
      },
    },
    "/api/sessions/:id": {
      GET: async (req) => {
        const session = await getSession(req.params.id);
        if (!session) return Response.json({ error: "session not found" }, { status: 404 });
        return Response.json(getConversationEntries(session));
      },
      DELETE: async (req) => {
        closeSessionSockets(req.params.id);
        const result = await deleteSession(req.params.id);
        if (!result.ok) return Response.json({ error: "session not found" }, { status: 404 });
        return Response.json(result);
      },
    },

    // ── Terminal (PTY) ─────────────────────────────────────────────
    // Spawn a real shell. Returns { ptyId, shell, cwd, title }. The
    // client then opens a WebSocket on /ws/pty/:ptyId to drive it.
    "/api/pty/start": {
      POST: async (req) => {
        const body = (await req.json().catch(() => ({}))) as {
          cwd?: string;
          cols?: number;
          rows?: number;
          shell?: string;
        };
        try {
          return Response.json(
            startPty({
              cwd: body.cwd,
              cols: body.cols ?? 80,
              rows: body.rows ?? 24,
              shell: body.shell,
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
        const cwd = new URL(req.url).searchParams.get("cwd") ?? undefined;
        try {
          return Response.json(await getStatus(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/diff": {
      GET: async (req) => {
        const url = new URL(req.url);
        const cwd = url.searchParams.get("cwd") ?? undefined;
        const path = url.searchParams.get("path") ?? "";
        const staged = url.searchParams.get("staged") === "1";
        try {
          return Response.json({ diff: await getDiff(cwd, path, staged) });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stage": {
      POST: async (req) => {
        const { cwd, paths } = (await req.json().catch(() => ({}))) as { cwd?: string; paths?: string[] };
        try {
          await stagePaths(cwd, paths);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/unstage": {
      POST: async (req) => {
        const { cwd, paths } = (await req.json().catch(() => ({}))) as { cwd?: string; paths?: string[] };
        try {
          await unstagePaths(cwd, paths ?? []);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/commit": {
      POST: async (req) => {
        const { cwd, message } = (await req.json().catch(() => ({}))) as { cwd?: string; message?: string };
        try {
          await commit(cwd, message ?? "");
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },

    // ── Filesystem (files panel) ─────────────────────────────────
    // Paths are absolute, or relative to the active workspace. The
    // active workspace defaults to the user's home directory but the
    // client passes the session cwd as `workspaceRoot` so the file tree
    // tracks wherever the user opened the session (a Windows project on
    // a different drive than the home directory is the motivating case).
    // Anything outside that workspace returns 400 — outside-workspace
    // grants are intentionally deferred until workspace switching lands.
    "/api/fs/list": {
      GET: async (req) => {
        const url = new URL(req.url);
        const path = url.searchParams.get("path") ?? undefined;
        const workspaceRoot = url.searchParams.get("workspaceRoot") ?? undefined;
        try {
          return Response.json(await listDirectory(path, workspaceRoot));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/fs/search": {
      GET: async (req) => {
        const url = new URL(req.url);
        const q = url.searchParams.get("q") ?? "";
        const workspaceRoot = url.searchParams.get("workspaceRoot") ?? undefined;
        return Response.json({ entries: await searchFiles(q, 60, workspaceRoot) });
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
    // Serve the built SPA when it exists: `dist-web/` in the npm package,
    // `packages/web/dist` in the source repo. Dev uses Vite instead.
    const webDist = [
      join(import.meta.dir, "..", "dist-web"),
      join(import.meta.dir, "..", "web", "dist"),
    ].find((dir) => existsSync(join(dir, "index.html")));

    const serveWeb = async (url: URL): Promise<Response | null> => {
      if (!webDist) return null;
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(join(webDist, pathname));
      if (await file.exists()) return new Response(file);
      // SPA fallback: any unknown path serves the app shell.
      const index = Bun.file(join(webDist, "index.html"));
      if (await index.exists()) return new Response(index, { headers: { "Content-Type": "text/html" } });
      return null;
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

console.log("Server listening on http://localhost:3000");

// Best-effort cleanup on shutdown. Useful when Bun restarts in --hot mode.
const shutdown = () => {
  stopAllPtys();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
