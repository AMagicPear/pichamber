import { Hono } from "hono";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const app = new Hono();

app.get("/api/health", (context) => context.json({ ok: true }));

app.get("/api/sessions", async (context) => {
	const sessions = await SessionManager.listAll();
	return context.json(sessions);
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