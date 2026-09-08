import {
  checkout,
  commit,
  discardPaths,
  fetchRemotes,
  getDiff,
  getStatus,
  init,
  listBranches,
  listStashes,
  pull,
  push,
  stagePaths,
  stash,
  stashDrop,
  stashPop,
  unstagePaths,
} from "../services/git";
import { fsErrorResponse, requestCwd, type Routes } from "./http";

type Paths =
  | "/api/git/status"
  | "/api/git/diff"
  | "/api/git/stage"
  | "/api/git/unstage"
  | "/api/git/commit"
  | "/api/git/discard"
  | "/api/git/init"
  | "/api/git/branches"
  | "/api/git/checkout"
  | "/api/git/push"
  | "/api/git/pull"
  | "/api/git/fetch"
  | "/api/git/stashes"
  | "/api/git/stash"
  | "/api/git/stash/pop"
  | "/api/git/stash/drop";

type GitBody = {
  sessionId?: string;
  paths?: string[];
  message?: string;
  branch?: string;
  index?: number;
  includeUntracked?: boolean;
};

/** Run `op` against the workspace from the JSON body's sessionId. All
 *  commands run inside the active workspace; paths are workspace-relative.
 *  Not a git repository → 400 with git's message. */
const withBodyCwd = async (
  req: Request,
  op: (cwd: string, body: GitBody) => Promise<Response>,
): Promise<Response> => {
  const body = (await req.json().catch(() => ({}))) as GitBody;
  try {
    return await op(await requestCwd(body.sessionId), body);
  } catch (err) {
    return fsErrorResponse(err);
  }
};

/** Run `op` against the workspace from the query's sessionId. */
const withQueryCwd = async (
  req: Request,
  op: (cwd: string) => Promise<Response>,
): Promise<Response> => {
  try {
    return await op(await requestCwd(new URL(req.url).searchParams.get("sessionId")));
  } catch (err) {
    return fsErrorResponse(err);
  }
};

export const gitRoutes: Routes<Paths> = {
  "/api/git/status": {
    GET: (req) => withQueryCwd(req, async (cwd) => Response.json(await getStatus(cwd))),
  },

  "/api/git/diff": {
    GET: (req) => {
      const url = new URL(req.url);
      return withQueryCwd(req, async (cwd) =>
        Response.json({ diff: await getDiff(cwd, url.searchParams.get("path") ?? "", url.searchParams.get("staged") === "1") }),
      );
    },
  },

  "/api/git/stage": {
    POST: (req) =>
      withBodyCwd(req, async (cwd, body) => {
        await stagePaths(cwd, body.paths);
        return Response.json({ ok: true });
      }),
  },

  "/api/git/unstage": {
    POST: (req) =>
      withBodyCwd(req, async (cwd, body) => {
        await unstagePaths(cwd, body.paths ?? []);
        return Response.json({ ok: true });
      }),
  },

  "/api/git/commit": {
    POST: (req) =>
      withBodyCwd(req, async (cwd, body) => {
        await commit(cwd, body.message ?? "");
        return Response.json({ ok: true });
      }),
  },

  "/api/git/discard": {
    POST: (req) =>
      withBodyCwd(req, async (cwd, body) => {
        await discardPaths(cwd, body.paths ?? []);
        return Response.json({ ok: true });
      }),
  },

  "/api/git/init": {
    POST: (req) =>
      withBodyCwd(req, async (cwd) => {
        await init(cwd);
        return Response.json(await getStatus(cwd));
      }),
  },

  "/api/git/branches": {
    GET: (req) => withQueryCwd(req, async (cwd) => Response.json(await listBranches(cwd))),
  },

  "/api/git/checkout": {
    POST: (req) =>
      withBodyCwd(req, async (cwd, body) => {
        await checkout(cwd, body.branch ?? "");
        return Response.json(await getStatus(cwd));
      }),
  },

  "/api/git/push": {
    POST: (req) =>
      withBodyCwd(req, async (cwd) => {
        await push(cwd);
        return Response.json({ ok: true });
      }),
  },

  "/api/git/pull": {
    POST: (req) =>
      withBodyCwd(req, async (cwd) => {
        await pull(cwd);
        return Response.json({ ok: true });
      }),
  },

  "/api/git/fetch": {
    POST: (req) =>
      withBodyCwd(req, async (cwd) => {
        await fetchRemotes(cwd);
        return Response.json({ ok: true });
      }),
  },

  "/api/git/stashes": {
    GET: (req) => withQueryCwd(req, async (cwd) => Response.json(await listStashes(cwd))),
  },

  "/api/git/stash": {
    POST: (req) =>
      withBodyCwd(req, async (cwd, body) => {
        await stash(cwd, body.message, body.includeUntracked !== false);
        return Response.json(await listStashes(cwd));
      }),
  },

  "/api/git/stash/pop": {
    POST: (req) =>
      withBodyCwd(req, async (cwd) => {
        await stashPop(cwd);
        return Response.json(await listStashes(cwd));
      }),
  },

  "/api/git/stash/drop": {
    POST: (req) =>
      withBodyCwd(req, async (cwd, body) => {
        await stashDrop(cwd, body.index ?? -1);
        return Response.json(await listStashes(cwd));
      }),
  },
};
