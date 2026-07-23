import { Hono } from "hono";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSessionWithCwd, listAllSessions } from "./agent";

const app = new Hono();

app.get("/api/health", (context) => context.json({ ok: true }));

app.get("/api/sessions", async (context) => {
  const sessions = await listAllSessions();
  return context.json(sessions);
});

app.post("/api/sessions", async (context) => {
  const { cwd } = await context.req.json<{ cwd: string }>();
  const session = await createSessionWithCwd(cwd);
  return context.json({ sessionPath: session.sessionFile });
});

app.get("/api/sessions/*", (context) => {
  const encoded = context.req.path.slice("/api/sessions/".length);
  const sessionPath = decodeURIComponent(encoded);
  const session = SessionManager.open(sessionPath);
  return context.json(session.getEntries());
});

export default {
  port: 3000,
  fetch: app.fetch,
};
