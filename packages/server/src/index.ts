import { join } from "node:path";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { configuredPort, daemonToken, hostname, instanceId, version } from "./config";
import { hasPty, stopAllPtys } from "./services/pty";
import { sessionWsHandler } from "./core/ws";
import type { PtyWsData, SessionWsData, WsData } from "./core/ws";
import { ptyRoutes, ptyWsHandler } from "./routes/pty";
import { systemRoutes } from "./routes/system";
import { sessionRoutes } from "./routes/sessions";
import { piRoutes } from "./routes/pi";
import { settingsRoutes } from "./routes/settings";
import { gitRoutes } from "./routes/git";
import { fsRoutes } from "./routes/fs";
import { diagnosticsRoutes } from "./routes/diagnostics";
import { FileLogger, errorEvent, setSharedLogger } from "./diagnostics/logger";
import { installGlobalHandlers } from "./diagnostics/global-handlers";

// ─── Diagnostics: install a process-wide JSONL logger before anything
// else can throw. Unhandled exceptions and rejections get funneled here so
// even unexpected failures leave a trace in the local report. ────────
const diagnosticsLogger = new FileLogger();
setSharedLogger(diagnosticsLogger);
installGlobalHandlers(diagnosticsLogger);
const bootLogger = diagnosticsLogger.child({ scope: "server.boot" });
bootLogger.emit({
  level: "info",
  scope: "server.boot",
  msg: `startup pichamber ${version}`,
  extra: { hostname, port: configuredPort, instanceId, pi: PI_VERSION },
});

// ─── HTTP + WebSocket server ───────────────────────────────────────────
//
// HTTP routes live in `routes/*.ts`, grouped by domain, and are assembled
// here. WebSocket upgrades (session + PTY) are handled in `fetch`, because
// Bun's route table is for plain HTTP; the per-socket protocol handlers are
// attached to `ws.data.handler` at upgrade time so the `websocket` callbacks
// below stay a pure multiplexer.
const server = Bun.serve({
  hostname,
  port: configuredPort,
  routes: {
    ...systemRoutes,
    ...sessionRoutes,
    ...piRoutes,
    ...settingsRoutes,
    ...ptyRoutes,
    ...gitRoutes,
    ...fsRoutes,
    ...diagnosticsRoutes,
    "/api/daemon/shutdown": {
      POST: (req) => {
        if (!daemonToken || req.headers.get("Authorization") !== `Bearer ${daemonToken}`) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        setTimeout(shutdown, 0);
        return Response.json({ ok: true });
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
      diagnosticsLogger.emit({
        level: "debug",
        scope: "server.ws",
        msg: "socket open",
        extra: { protocol: ws.data.protocol },
      });
      try {
        await ws.data.handler.open(ws);
      } catch (error) {
        diagnosticsLogger.emit(errorEvent("socket open failed", error, "server.ws"));
        throw error;
      }
    },
    async message(ws, message) {
      try {
        await ws.data.handler.message(ws, message);
      } catch (error) {
        diagnosticsLogger.emit(errorEvent("socket message failed", error, "server.ws"));
        throw error;
      }
    },
    close(ws, code, reason) {
      try {
        ws.data.handler.close(ws);
      } finally {
        diagnosticsLogger.emit({
          level: "debug",
          scope: "server.ws",
          msg: "socket close",
          extra: { protocol: ws.data.protocol, code, reason: reason.toString() },
        });
      }
    },
  },
});

bootLogger.emit({
  scope: "server.boot",
  msg: `listening on http://${hostname}:${configuredPort}`,
  extra: { hostname, port: configuredPort },
});

// Best-effort cleanup on shutdown. Useful when Bun restarts in --hot mode.
const shutdown = () => {
  stopAllPtys();
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
