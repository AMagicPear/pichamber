import { listDirectory, openFile, searchFiles } from "../services/fs";
import { getFileEditor } from "../settings/app-config";
import { getWorkspace, resolveInWorkspace } from "../services/workspace";
import { fsErrorResponse, requestCwd, withSessionCwd, type Routes } from "./http";

type Paths = "/api/fs/list" | "/api/fs/search" | "/api/fs/open" | "/api/fs/raw";

// The server resolves the active workspace from sessionId. Paths may be
// absolute or workspace-relative; canonical paths outside it are rejected.
// `/api/fs/open` is the one exception: it opens whatever path it's given
// (relative to the workspace, `~/…`, or absolute), like the terminal.
export const fsRoutes: Routes<Paths> = {
  "/api/fs/list": {
    GET: (req) => {
      const url = new URL(req.url);
      const path = url.searchParams.get("path") ?? undefined;
      return withSessionCwd(url.searchParams.get("sessionId"), async (cwd) =>
        Response.json(await listDirectory(path, cwd)),
      );
    },
  },

  "/api/fs/search": {
    GET: (req) => {
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      return withSessionCwd(url.searchParams.get("sessionId"), async (cwd) =>
        Response.json({ entries: await searchFiles(q, 60, cwd, req.signal) }),
      );
    },
  },

  "/api/fs/open": {
    GET: (req) => {
      const url = new URL(req.url);
      const path = url.searchParams.get("path") ?? "";
      if (!path) return Response.json({ error: "path is required" }, { status: 400 });
      return withSessionCwd(url.searchParams.get("sessionId"), async (cwd) =>
        Response.json(await openFile(path, cwd, getFileEditor())),
      );
    },
  },

  // Streams a workspace-resolved file back to the browser so markstream-vue's
  // `LocalFileImage` can render `<img src="/api/fs/raw?…">` for local paths
  // the same way `LocalFileLink` calls `/api/fs/open` for local links.
  // Bun.file auto-detects Content-Type from the extension.
  "/api/fs/raw": {
    GET: async (req) => {
      const url = new URL(req.url);
      const path = url.searchParams.get("path") ?? "";
      const sessionId = url.searchParams.get("sessionId");
      if (!path) return Response.json({ error: "path is required" }, { status: 400 });
      try {
        // `requestCwd` throws on an unknown session, but an image src only
        // needs a session cwd for relative `./…` paths — an absolute path
        // doesn't care. Fall back to home instead of failing the whole
        // request, so a stale or missing sessionId never breaks
        // otherwise-displayable images.
        const cwd = sessionId ? await requestCwd(sessionId).catch(() => getWorkspace()) : getWorkspace();
        const file = Bun.file(resolveInWorkspace(path, cwd));
        return new Response(file, { headers: { "Content-Type": file.type } });
      } catch (err) {
        return fsErrorResponse(err);
      }
    },
  },
};
