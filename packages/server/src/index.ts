import { PtyState } from "./pty";
import { createSessionWithCwd, deleteSession, getSession, listAllSessions } from "./session";
import type { ServerWebSocket } from "bun";
import { wsHandlers } from "./ws";

// All shared runtime state lives in a single object so the routes below stay
// pure functions of (state, req). Matches the legacy server.ts layout.
const state = {
  pty: new PtyState(),
};

// Union of WS data shapes the server knows how to upgrade. AI session WS use
// { sessionId } (legacy); PTY WS use { type: "pty", ptyId } plus a per-socket
// unsubscribe handle.
type WsData =
  | { sessionId: string }
  | { type: "pty"; ptyId: string; unsub?: () => void };

function isPtyData(d: unknown): d is { type: "pty"; ptyId: string; unsub?: () => void } {
  return !!d && typeof d === "object" && (d as { type?: unknown }).type === "pty";
}

Bun.serve({
  port: 3000,
  routes: {
    "/api/health": {
      GET: () => Response.json({ ok: true }),
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
        return Response.json(session.sessionManager.getEntries());
      },
      DELETE: async (req) => {
        const result = await deleteSession(req.params.id);
        if (!result.ok) return Response.json({ error: "session not found" }, { status: 404 });
        return Response.json(result);
      },
    },

    // ── Terminal (PTY) ─────────────────────────────────────────────
    // Spawn a real shell. Returns { ptyId, shell, cwd }. The client then opens
    // a WebSocket on /ws/pty/:ptyId to drive it.
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
            state.pty.start({
              cwd: body.cwd,
              cols: body.cols ?? 80,
              rows: body.rows ?? 24,
              shell: body.shell,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
  fetch(req, server) {
    const url = new URL(req.url);

    // PTY WebSocket — /ws/pty/:ptyId (checked first so it doesn't get eaten
    // by the generic /ws/ prefix match below).
    const ptyMatch = url.pathname.match(/^\/ws\/pty\/([^/]+)$/);
    if (ptyMatch) {
      const ptyId = ptyMatch[1]!;
      if (!state.pty.has(ptyId)) {
        return new Response("PTY not found", { status: 404 });
      }
      const success = server.upgrade(req, { data: { type: "pty", ptyId } });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // AI session WebSocket — /ws/:sessionId (existing flow)
    if (url.pathname.startsWith("/ws/")) {
      const sessionId = url.pathname.slice(4);
      const success = server.upgrade(req, { data: { sessionId } });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    async open(ws: ServerWebSocket<WsData>) {
      if (isPtyData(ws.data)) {
        // Subscribe the WS to PTY output. Stash the unsub on ws.data so
        // close() can release it.
        const unsub = state.pty.subscribe(ws.data.ptyId, (chunk) => {
          if (ws.readyState === 1) ws.send(chunk);
        });
        ws.data.unsub = unsub;
        return;
      }
      // AI session: defer to the legacy handler.
      await (
        wsHandlers.open as (ws: ServerWebSocket<{ sessionId: string }>) => Promise<void>
      )(ws as ServerWebSocket<{ sessionId: string }>);
    },
    async message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      if (isPtyData(ws.data)) {
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
              state.pty.resize(ws.data.ptyId, ctrl.cols, ctrl.rows);
              return;
            }
          }
          state.pty.write(ws.data.ptyId, text);
        } catch (err) {
          ws.close(1011, err instanceof Error ? err.message : String(err));
        }
        return;
      }
      await (
        wsHandlers.message as (
          ws: ServerWebSocket<{ sessionId: string }>,
          message: string | Buffer,
        ) => Promise<void>
      )(ws as ServerWebSocket<{ sessionId: string }>, message);
    },
    close(ws: ServerWebSocket<WsData>) {
      if (isPtyData(ws.data)) {
        ws.data.unsub?.();
        // Tear the shell down with the socket. If the user opens another tab
        // later, they'll get a fresh ptyId from /api/pty/start.
        state.pty.stop(ws.data.ptyId);
        return;
      }
      (wsHandlers.close as (ws: ServerWebSocket<{ sessionId: string }>) => void)(
        ws as ServerWebSocket<{ sessionId: string }>,
      );
    },
  },
});

console.log("Server listening on http://localhost:3000");

// Best-effort cleanup on shutdown. Useful when Bun restarts in --hot mode.
const shutdown = () => {
  state.pty.stopAll();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);