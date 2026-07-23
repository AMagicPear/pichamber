import { createSessionWithCwd, deleteSession, getSession, listAllSessions } from "./session";
import { wsHandlers } from "./ws";

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
        return Response.json({ sessionId: session.sessionId });
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
        return Response.json({ ok: true });
      },
    },
  },
  fetch(req, server) {
    // WebSocket 升级：/ws/:sessionId
    const url = new URL(req.url);
    if (url.pathname.startsWith("/ws/")) {
      const sessionId = url.pathname.slice(4);
      const success = server.upgrade(req, { data: { sessionId } });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: wsHandlers,
});

console.log("Server listening on http://localhost:3000");
