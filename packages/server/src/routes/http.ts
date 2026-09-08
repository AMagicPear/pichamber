/**
 * Shared HTTP primitives for the route modules.
 *
 * Every `routes/*.ts` module imports session resolution, error mapping, and
 * the SDK-runtime guard from here. Adding a route should mean writing the
 * handler, not copying the same fifteen lines of session/error boilerplate.
 */
import { basename, dirname, isAbsolute } from "node:path";
import { getAgentDir, loadSkills, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { DisabledSkillInfo } from "@amagicpear/pichamber-shared";
import { SdkSessionDriver } from "../core/driver";
import { getSessionCwd, getSessionDriver } from "../core/session";
import { errorEvent, getLogger } from "../diagnostics/logger";
import { RuntimeModeError, toMessage } from "../error";
import type { WsData } from "../core/ws";
import { canonicalWorkspace, getWorkspace, WorkspaceError } from "../services/workspace";

/** Bun's route-object type for a module that owns `Paths`, so `req.params` is
 *  inferred per path instead of collapsing to `Record<string, string>`. */
export type Routes<Paths extends string> = Bun.Serve.Routes<WsData, Paths>;

export const badRequest = (error: string) => Response.json({ error }, { status: 400 });

/** Map a workspace/filesystem error to an HTTP response. */
export const fsErrorResponse = (err: unknown): Response => {
  if (err instanceof WorkspaceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === "ENOENT") return Response.json({ error: "Not found" }, { status: 404 });
  if (code === "EACCES") return Response.json({ error: "Permission denied" }, { status: 403 });
  const message = toMessage(err);
  // Resolved lazily: route modules are imported before index.ts installs the
  // shared logger, so a module-level `getLogger()` would capture a throwaway.
  getLogger("server.http").emit(errorEvent("Filesystem operation failed", err, "server.fs"));
  return Response.json({ error: message }, { status: 500 });
};

/** `?sessionId=` or null. */
export const sessionIdFrom = (req: Request): string | null =>
  new URL(req.url).searchParams.get("sessionId");

/** Resolve the active workspace for a session, or the global workspace when
 *  no session id is given. Throws WorkspaceError when the session is gone. */
export const requestCwd = async (sessionId?: string | null): Promise<string> => {
  if (!sessionId) return getWorkspace();
  const cwd = await getSessionCwd(sessionId);
  if (!cwd) throw new WorkspaceError("Session not found", 404);
  return canonicalWorkspace(cwd);
};

/** Resolve an SDK-backed session, or a ready-to-return error descriptor. */
export const getSdkSession = async (sessionId: string) => {
  const driver = await getSessionDriver(sessionId);
  if (!driver) return { error: "session not found", status: 404 } as const;
  if (!(driver instanceof SdkSessionDriver)) {
    const error = new RuntimeModeError("sdk");
    return { error: error.message, status: error.status } as const;
  }
  return { session: driver.session, cwd: driver.cwd } as const;
};

/**
 * Run `handler` against the request's SDK session. Missing sessionId → 400,
 * unknown session → 404, non-SDK runtime → 409, and a throwing handler →
 * `errorStatus` (400 by default, matching the original inline handlers).
 */
export const withSdkSession = async (
  req: Request,
  handler: (session: AgentSession, cwd: string, sessionId: string) => Promise<Response> | Response,
  errorStatus = 400,
): Promise<Response> => {
  const sessionId = sessionIdFrom(req);
  if (!sessionId) return badRequest("sessionId required");
  const result = await getSdkSession(sessionId);
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  try {
    return await handler(result.session, result.cwd, sessionId);
  } catch (error) {
    return Response.json({ error: toMessage(error) }, { status: errorStatus });
  }
};

/** Run `handler` against a workspace cwd, mapping fs/workspace failures. */
export const withSessionCwd = async (
  sessionId: string | null | undefined,
  handler: (cwd: string) => Promise<Response> | Response,
): Promise<Response> => {
  try {
    return await handler(await requestCwd(sessionId));
  } catch (err) {
    return fsErrorResponse(err);
  }
};

/** Describe skill paths disabled with the `-<absolute-path>` rule form. */
export const getDisabledSkills = (paths: string[], cwd: string): DisabledSkillInfo[] =>
  paths
    .filter((path) => path.startsWith("-") && isAbsolute(path.slice(1)))
    .map((rule) => rule.slice(1))
    .map((path) => {
      const skill = loadSkills({ cwd, agentDir: getAgentDir(), skillPaths: [path], includeDefaults: false }).skills[0];
      return {
        name: skill?.name ?? basename(dirname(path)),
        description: skill?.description,
        path,
      };
    });
