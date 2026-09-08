import { toMessage } from "../error";
import {
  resizePty,
  startPty,
  stopPty,
  subscribePty,
  subscribePtyExit,
  writePty,
} from "../services/pty";
import type { PtyWsData, WsHandler } from "../core/ws";
import { requestCwd, type Routes } from "./http";

type Paths = "/api/pty/start" | "/api/pty/:id";

// Spawn a real shell. Returns { ptyId, shell, cwd, title }. The client then
// opens a WebSocket on /ws/pty/:ptyId to drive it.
export const ptyRoutes: Routes<Paths> = {
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
        return Response.json({ error: toMessage(err) }, { status: 500 });
      }
    },
  },

  "/api/pty/:id": {
    DELETE: (req) => {
      stopPty(req.params.id);
      return Response.json({ ok: true });
    },
  },
};

/** PTY WebSocket protocol handler, attached on upgrade by `index.ts`. */
export const ptyWsHandler: WsHandler = {
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
        if (ctrl.type === "resize" && typeof ctrl.cols === "number" && typeof ctrl.rows === "number") {
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
    (ws.data as PtyWsData).unsub?.();
  },
};
