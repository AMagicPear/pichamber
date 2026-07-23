import { Hono } from "hono";
import { createSessionWithCwd, deleteSession, getSession, listAllSessions } from "./session";

const app = new Hono();

app.get("/api/health", (context) => context.json({ ok: true }));

// 列出所有已有的会话
app.get("/api/sessions", async (context) => {
  const sessions = await listAllSessions();
  return context.json(sessions);
});

// 传入一个cwd创建新的会话 并返回ID
app.post("/api/sessions", async (context) => {
  const { cwd } = await context.req.json<{ cwd: string }>();
  const session = await createSessionWithCwd(cwd);
  return context.json({ sessionId: session.sessionId });
});

// 根据ID获取会话的信息
app.get("/api/sessions/:id", async (context) => {
  const id = context.req.param("id");
  const session = await getSession(id);
  if (!session) return context.json({ error: "session not found" }, 404);
  return context.json(session.sessionManager.getEntries());
});

// 根据ID删除会话（同时删除本地文件）
app.delete("/api/sessions/:id", async (context) => {
  const id = context.req.param("id");
  const deleted = await deleteSession(id);
  if (!deleted) return context.json({ error: "session not found" }, 404);
  return context.json({ ok: true });
});

export default {
  port: 3000,
  fetch: app.fetch,
};
