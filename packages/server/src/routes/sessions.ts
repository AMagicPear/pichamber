import {
  copySessionToCwd,
  createSessionWithCwd,
  deleteSession,
  forkSessionAt,
  hasUsableSessionCwd,
  listAllSessions,
  renameSession,
} from "../core/session";
import { closeSessionSockets } from "../core/ws";
import { toMessage } from "../error";
import { browseProjectDirectories } from "../services/projects";
import { canonicalWorkspace, WorkspaceError } from "../services/workspace";
import { badRequest, fsErrorResponse, type Routes } from "./http";

type Paths =
  | "/api/sessions"
  | "/api/sessions/:id"
  | "/api/sessions/:id/fork"
  | "/api/sessions/:id/copy"
  | "/api/projects/browse";

export const sessionRoutes: Routes<Paths> = {
  "/api/sessions": {
    GET: async () => {
      const sessions = await listAllSessions();
      return Response.json(
        await Promise.all(
          sessions.map(async (session) => ({
            ...session,
            cwd: await canonicalWorkspace(session.cwd).catch(() => session.cwd),
            cwdAvailable: hasUsableSessionCwd(session.cwd),
          })),
        ),
      );
    },
    POST: async (req) => {
      try {
        const { cwd } = (await req.json()) as { cwd: string };
        const workspace = await canonicalWorkspace(cwd);
        const driver = await createSessionWithCwd(workspace);
        return Response.json({
          sessionId: driver.sessionId,
          cwd: workspace,
          sessionFile: driver.sessionFile,
        });
      } catch (err) {
        return fsErrorResponse(err);
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
      if (!trimmed) return badRequest("name required");
      const ok = await renameSession(req.params.id, trimmed);
      if (!ok) return Response.json({ error: "session not found" }, { status: 404 });
      return Response.json({ ok: true });
    },
  },

  "/api/sessions/:id/fork": {
    POST: async (req) => {
      const { entryId } = (await req.json().catch(() => ({}))) as { entryId?: unknown };
      if (typeof entryId !== "string" || !entryId) return badRequest("entryId required");
      try {
        return Response.json(await forkSessionAt(req.params.id, entryId));
      } catch (error) {
        const message = toMessage(error);
        return Response.json({ error: message }, { status: message === "Session not found" ? 404 : 400 });
      }
    },
  },

  "/api/sessions/:id/copy": {
    POST: async (req) => {
      const { cwd } = (await req.json().catch(() => ({}))) as { cwd?: unknown };
      if (typeof cwd !== "string" || !cwd.trim()) return badRequest("cwd required");
      try {
        const workspace = await canonicalWorkspace(cwd);
        return Response.json(await copySessionToCwd(req.params.id, workspace));
      } catch (error) {
        const message = toMessage(error);
        const status = error instanceof WorkspaceError ? error.status : message === "Session not found" ? 404 : 400;
        return Response.json({ error: message }, { status });
      }
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
};
