import { basename, dirname, isAbsolute, join } from "node:path";
import { getAgentDir, loadSkills, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { listDirectory, openFile, searchFiles } from "./services/fs";
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
} from "./services/git";
import {
  createSessionWithCwd,
  copySessionToCwd,
  deleteSession,
  forkSessionAt,
  getSessionCwd,
  getSessionDriver,
  hasUsableSessionCwd,
  listAllSessions,
  renameSession,
  switchExecutionBackend,
} from "./core/session";
import {
  hasPty,
  resizePty,
  startPty,
  stopAllPtys,
  stopPty,
  subscribePty,
  subscribePtyExit,
  writePty,
} from "./services/pty";
import { closeSessionSockets, sessionWsHandler } from "./core/ws";
import { refreshSessionModelState } from "./core/ws";
import { type PtyWsData, type SessionWsData, type WsData, type WsHandler } from "./core/ws";
import { FileLogger, errorEvent, setSharedLogger } from "./diagnostics/logger";
import { installGlobalHandlers } from "./diagnostics/global-handlers";
import { getDiagnosticsLogDir } from "./diagnostics/paths";
import { readServerTail } from "./diagnostics/server-tail";
import { browseProjectDirectories } from "./services/projects";
import { getProviderQuota, listQuotaProviders } from "./providers/quota";
import { SdkSessionDriver } from "./core/driver";
import { RuntimeModeError, toMessage } from "./error";
import { getExecutionBackend, getFileEditor, loadAppConfig, setFileEditor } from "./settings/app-config";
import { getMcpOverview, setMcpServerEnabled } from "./settings/mcp-config";
import { canonicalWorkspace, getWorkspace, WorkspaceError } from "./services/workspace";
import type { DisabledSkillInfo, ExtensionsOverview, LoadedExtensionInfo, LoadedSkillInfo, SkillsOverview } from "@amagicpear/pichamber-shared";
import {
  getPiBehaviorSettings,
  listPiProviders,
  removePiProviderCredential,
  setPiProviderApiKey,
  updatePiBehaviorSettings,
} from "./settings/pi-config";
import {
  checkPiExtensionUpdates,
  installPiExtensionSource,
  listPiExtensionSources,
  removePiExtensionSource,
  updatePiExtensions,
} from "./extensions/pi-extensions";
import {
  getBuiltinExtension,
  installBuiltinExtension,
  installedExtensionPath,
  listBuiltinExtensions,
  removeBuiltinExtension,
} from "./extensions/builtin-extensions";

const hostname = process.env.PICHAMBER_HOST || "127.0.0.1";
const configuredPort = Number(process.env.PICHAMBER_PORT || 3000);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error(`Invalid PICHAMBER_PORT: ${process.env.PICHAMBER_PORT}`);
}
const version = process.env.PICHAMBER_VERSION || "dev";
const instanceId = process.env.PICHAMBER_INSTANCE_ID;
const daemonToken = process.env.PICHAMBER_DAEMON_TOKEN;
const startedAt = new Date().toISOString();

// ─── Diagnostics: install a process-wide JSONL logger before anything
// else can throw. Unhandled exceptions and rejections get funneled here so
// even unexpected failures leave a trace in the local report. ────────
const diagnosticsLogger = new FileLogger();
setSharedLogger(diagnosticsLogger);
installGlobalHandlers(diagnosticsLogger);
const bootLogger = diagnosticsLogger.child({ scope: "server.boot" });
bootLogger.emit({
  level: "info",
  scope: "server.boot",
  msg: `startup pichamber ${version}`,
  extra: { hostname, port: configuredPort, instanceId, pi: PI_VERSION },
});

// ─── WebSocket protocol multiplexing ───────────────────────────────────
//
// Bun's `websocket` callbacks receive (ws, message) — the data payload is
// always reachable via `ws.data`. We use that: at upgrade time we attach
// the matching handler to `ws.data.handler`, and the multiplex code below
// just forwards. Adding a new protocol means writing one `WsHandler` and
// attaching it on upgrade — no edits to the multiplex code. The protocol
// types (`WsHandler`, `PtyWsData`, `SessionWsData`, `WsData`) live in
// `ws.ts`, which owns the WS protocol surface.
/** Map a filesystem error to an HTTP response. */
const fsErrorResponse = (err: unknown): Response => {
  if (err instanceof WorkspaceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === "ENOENT") return Response.json({ error: "Not found" }, { status: 404 });
  if (code === "EACCES") return Response.json({ error: "Permission denied" }, { status: 403 });
  const message = toMessage(err);
  diagnosticsLogger.emit(errorEvent("Filesystem operation failed", err, "server.fs"));
  return Response.json({ error: message }, { status: 500 });
};

const requestCwd = async (sessionId?: string | null) => {
  if (!sessionId) return getWorkspace();
  const cwd = await getSessionCwd(sessionId);
  if (!cwd) throw new WorkspaceError("Session not found", 404);
  return canonicalWorkspace(cwd);
};

const getSdkSession = async (sessionId: string) => {
  const driver = await getSessionDriver(sessionId);
  if (!driver) return { error: "session not found", status: 404 } as const;
  if (!(driver instanceof SdkSessionDriver)) {
    const error = new RuntimeModeError("sdk");
    return { error: error.message, status: error.status } as const;
  }
  return { session: driver.session, cwd: driver.cwd } as const;
};

const getDisabledSkills = (paths: string[], cwd: string): DisabledSkillInfo[] =>
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

const ptyWsHandler: WsHandler = {
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
        if (
          ctrl.type === "resize" &&
          typeof ctrl.cols === "number" &&
          typeof ctrl.rows === "number"
        ) {
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
    const data = ws.data as PtyWsData;
    data.unsub?.();
  },
};

// ─── HTTP + WebSocket server ───────────────────────────────────────────

const server = Bun.serve({
  hostname,
  port: configuredPort,
  routes: {
    "/api/health": {
      GET: () =>
        Response.json({
          ok: true,
          app: "pichamber",
          version,
          pi: PI_VERSION,
          pid: process.pid,
          startedAt,
          instanceId,
        }),
    },
    "/api/version": {
      GET: () => Response.json({ pi: PI_VERSION }),
    },
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
        const { cwd } = (await req.json()) as { cwd: string };
        const workspace = await canonicalWorkspace(cwd);
        const driver = await createSessionWithCwd(workspace);
        return Response.json({
          sessionId: driver.sessionId,
          cwd: workspace,
          sessionFile: driver.sessionFile,
        });
      },
    },
    "/api/pi/providers": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ providers: listPiProviders(result.session) });
      },
    },
    "/api/pi/providers/:provider/credential": {
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { apiKey?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
          return Response.json({ error: "apiKey required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const providers = await setPiProviderApiKey(result.session, req.params.provider, body.apiKey.trim());
          refreshSessionModelState(sessionId);
          return Response.json({ providers });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
      DELETE: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const providers = await removePiProviderCredential(result.session, req.params.provider);
          refreshSessionModelState(sessionId);
          return Response.json({ providers });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/settings/execution-backend": {
      GET: async () => {
        await loadAppConfig();
        return Response.json({ executionBackend: getExecutionBackend() });
      },
      PUT: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { executionBackend?: unknown };
        if (body.executionBackend !== "sdk" && body.executionBackend !== "rpc") {
          return Response.json({ error: "executionBackend must be sdk or rpc" }, { status: 400 });
        }
        try {
          await switchExecutionBackend(body.executionBackend, closeSessionSockets);
          return Response.json({ executionBackend: body.executionBackend, reload: true });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 500 });
        }
      },
    },
    "/api/settings/editor": {
      GET: async () => {
        await loadAppConfig();
        return Response.json({ fileEditor: getFileEditor() });
      },
      PUT: async (req) => {
        const fileEditor = (await req.json().catch(() => ({})) as { fileEditor?: unknown }).fileEditor;
        if (!["vscode", "cursor", "zed", "webstorm", "system"].includes(fileEditor as string)) {
          return Response.json({ error: "unsupported file editor" }, { status: 400 });
        }
        await setFileEditor(fileEditor as Parameters<typeof setFileEditor>[0]);
        return Response.json({ fileEditor });
      },
    },
    "/api/pi/behavior": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const driver = await getSessionDriver(sessionId);
        if (!driver) return Response.json({ error: "session not found" }, { status: 404 });
        if (!(driver instanceof SdkSessionDriver)) return Response.json({ error: new RuntimeModeError("sdk").message }, { status: 409 });
        return Response.json(getPiBehaviorSettings(driver.session));
      },
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const update = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          const current = await getSessionDriver(sessionId);
          if (!current) return Response.json({ error: "session not found" }, { status: 404 });
          if (getExecutionBackend() !== "sdk") {
            const error = new RuntimeModeError("sdk");
            return Response.json({ error: error.message }, { status: error.status });
          }
          return Response.json(await updatePiBehaviorSettings((current as SdkSessionDriver).session, update));
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 500 });
        }
      },
    },
    "/api/pi/extensions": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ sources: listPiExtensionSources(result.session, result.cwd) });
      },
      POST: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { source?: unknown; scope?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.source !== "string" || !body.source.trim()) {
          return Response.json({ error: "source required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const sources = await installPiExtensionSource(result.session, result.cwd, body.source.trim(), body.scope === "project");
          return Response.json({ sources });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
      DELETE: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { source?: unknown; scope?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.source !== "string" || !body.source.trim()) {
          return Response.json({ error: "source required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const sources = await removePiExtensionSource(result.session, result.cwd, body.source.trim(), body.scope === "project");
          return Response.json({ sources });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/extensions/overview": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const resources = result.session.resourceLoader.getExtensions();
          const sources = listPiExtensionSources(result.session, result.cwd);
          const builtins = listBuiltinExtensions();
          const overview: ExtensionsOverview = {
            builtins,
            sources,
            loaded: resources.extensions.map((e) => {
              const builtinMatch = builtins.find(
                (b) => e.path === installedExtensionPath(b.id) || e.path.startsWith(`${installedExtensionPath(b.id)}/`),
              );
              const entry: LoadedExtensionInfo = {
                label: builtinMatch?.name ?? (e.sourceInfo.source === "auto" ? basename(dirname(e.path)) : e.sourceInfo.source),
                path: e.path,
                source: e.sourceInfo.source,
                scope: e.sourceInfo.scope,
                origin: e.sourceInfo.origin,
                commands: [...e.commands.keys()],
                tools: [...e.tools.keys()],
              };
              if (builtinMatch) entry.builtinId = builtinMatch.id;
              return entry;
            }),
            diagnostics: resources.errors,
            inventoryAvailable: true,
          };
          return Response.json(overview);
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/extensions/updates": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          return Response.json({ updates: await checkPiExtensionUpdates(result.session, result.cwd) });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
      POST: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { source?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (body.source !== undefined && typeof body.source !== "string") {
          return Response.json({ error: "source must be a string" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          await updatePiExtensions(result.session, result.cwd, body.source?.trim() || undefined);
          await result.session.reload();
          return Response.json({ updates: await checkPiExtensionUpdates(result.session, result.cwd) });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/extensions/builtins": {
      GET: () => Response.json({ builtins: listBuiltinExtensions() }),
    },
    "/api/pi/extensions/builtins/:id": {
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const body = (await req.json().catch(() => ({}))) as { install?: unknown };
        if (typeof body.install !== "boolean") {
          return Response.json({ error: "install (boolean) required" }, { status: 400 });
        }
        try {
          const def = getBuiltinExtension(req.params.id);
          if (body.install) installBuiltinExtension(def);
          else removeBuiltinExtension(def);

          // 配置后重新加载当前 SDK 会话，让新扩展立即生效并刷新资源快照。
          const result = await getSdkSession(sessionId);
          if ("error" in result) {
            return Response.json({ builtins: listBuiltinExtensions() });
          }
          await result.session.reload();
          return Response.json({ builtins: listBuiltinExtensions() });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/skills/overview": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const resources = result.session.resourceLoader.getSkills();
          const overview: SkillsOverview = {
            skills: resources.skills.map((skill) => ({
              name: skill.name,
              description: skill.description,
              path: skill.filePath,
              source: skill.sourceInfo.source,
              scope: skill.sourceInfo.scope,
              origin: skill.sourceInfo.origin,
              disableModelInvocation: skill.disableModelInvocation,
            } satisfies LoadedSkillInfo)),
            disabledSkills: getDisabledSkills(result.session.settingsManager.getSkillPaths(), result.cwd),
            diagnostics: resources.diagnostics.map((diagnostic) => ({
              path: diagnostic.path ?? "(unknown)",
              error: diagnostic.message,
            })),
            enableSkillCommands: result.session.settingsManager.getEnableSkillCommands(),
            inventoryAvailable: true,
          };
          return Response.json(overview);
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/skills/enabled": {
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { path?: unknown; enabled?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.path !== "string" || !isAbsolute(body.path) || typeof body.enabled !== "boolean") {
          return Response.json({ error: "path (absolute string) and enabled (boolean) required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          const rule = `-${body.path}`;
          const paths = result.session.settingsManager.getSkillPaths();
          const nextPaths = body.enabled ? paths.filter((path) => path !== rule) : [...new Set([...paths, rule])];
          result.session.settingsManager.setSkillPaths(nextPaths);
          await result.session.settingsManager.flush();
          await result.session.reload();
          return Response.json({ enabled: body.enabled });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/skills/commands": {
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        if (typeof body.enabled !== "boolean") return Response.json({ error: "enabled (boolean) required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          result.session.settingsManager.setEnableSkillCommands(body.enabled);
          await result.session.settingsManager.flush();
          await result.session.reload();
          return Response.json({ enabled: result.session.settingsManager.getEnableSkillCommands() });
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/mcp/overview": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json(await getMcpOverview(result.cwd));
      },
    },
    "/api/pi/mcp/:name/enabled": {
      PUT: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
        if (!sessionId || typeof body.enabled !== "boolean") return Response.json({ error: "sessionId and enabled (boolean) required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          await setMcpServerEnabled(result.cwd, req.params.name, body.enabled);
          await result.session.reload();
          return Response.json(await getMcpOverview(result.cwd));
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
        }
      },
    },
    "/api/pi/mcp/:name/reconnect": {
      POST: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          await result.session.prompt(`/mcp reconnect ${req.params.name}`);
          return Response.json(await getMcpOverview(result.cwd));
        } catch (error) {
          return Response.json({ error: toMessage(error) }, { status: 400 });
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
        if (!trimmed) {
          return Response.json({ error: "name required" }, { status: 400 });
        }
        const ok = await renameSession(req.params.id, trimmed);
        if (!ok) return Response.json({ error: "session not found" }, { status: 404 });
        return Response.json({ ok: true });
      },
    },
    "/api/sessions/:id/fork": {
      POST: async (req) => {
        const { entryId } = (await req.json().catch(() => ({}))) as { entryId?: unknown };
        if (typeof entryId !== "string" || !entryId) {
          return Response.json({ error: "entryId required" }, { status: 400 });
        }
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
        if (typeof cwd !== "string" || !cwd.trim()) {
          return Response.json({ error: "cwd required" }, { status: 400 });
        }
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
    "/api/quota/providers": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
        return Response.json({ providers: listQuotaProviders(result.session) });
      },
    },
    "/api/quota/:provider": {
      GET: async (req) => {
        const provider = req.params.provider;
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        if (!sessionId) {
          return Response.json({ error: "sessionId required" }, { status: 400 });
        }
        try {
          const result = await getSdkSession(sessionId);
          if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
          return Response.json(await getProviderQuota(provider, result.session));
        } catch (err) {
          return Response.json({ error: toMessage(err) }, { status: 500 });
        }
      },
    },
    "/api/daemon/shutdown": {
      POST: (req) => {
        if (!daemonToken || req.headers.get("Authorization") !== `Bearer ${daemonToken}`) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }
        setTimeout(shutdown, 0);
        return Response.json({ ok: true });
      },
    },

    // ── Diagnostics ───────────────────────────────────────
    // Local-only endpoints. The browser calls /api/diagnostics/server to
    // pull a bounded tail of recent JSONL events so it can bundle them
    // into a single export. Both endpoints intentionally avoid echoing
    // any user-provided content — the report is built from server-local
    // records only.
    "/api/diagnostics/server": {
      GET: async (req) => {
        const url = new URL(req.url);
        const raw = Number(url.searchParams.get("tail") ?? "500");
        const tail = Number.isFinite(raw) ? Math.min(5_000, Math.max(1, Math.floor(raw))) : 500;
        try {
          const events = await readServerTail(tail);
          return Response.json({ directory: getDiagnosticsLogDir(), events });
        } catch (error) {
          return Response.json({ directory: getDiagnosticsLogDir(), events: [], error: toMessage(error) });
        }
      },
    },

    // ── Terminal (PTY) ─────────────────────────────────────────────
    // Spawn a real shell. Returns { ptyId, shell, cwd, title }. The
    // client then opens a WebSocket on /ws/pty/:ptyId to drive it.
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
          const message = toMessage(err);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
    "/api/pty/:id": {
      DELETE: (req) => {
        stopPty(req.params.id);
        return Response.json({ ok: true });
      },
    },

    // ── Git (Git pane) ──────────────────────────────────────────
    // All commands run inside the active workspace; paths are
    // workspace-relative. Not a git repository → 400 with git's message.
    "/api/git/status": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json(await getStatus(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/diff": {
      GET: async (req) => {
        const url = new URL(req.url);
        const sessionId = url.searchParams.get("sessionId");
        const path = url.searchParams.get("path") ?? "";
        const staged = url.searchParams.get("staged") === "1";
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json({ diff: await getDiff(cwd, path, staged) });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stage": {
      POST: async (req) => {
        const { sessionId, paths } = (await req.json().catch(() => ({}))) as { sessionId?: string; paths?: string[] };
        try {
          const cwd = await requestCwd(sessionId);
          await stagePaths(cwd, paths);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/unstage": {
      POST: async (req) => {
        const { sessionId, paths } = (await req.json().catch(() => ({}))) as { sessionId?: string; paths?: string[] };
        try {
          const cwd = await requestCwd(sessionId);
          await unstagePaths(cwd, paths ?? []);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/commit": {
      POST: async (req) => {
        const { sessionId, message } = (await req.json().catch(() => ({}))) as { sessionId?: string; message?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await commit(cwd, message ?? "");
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/discard": {
      POST: async (req) => {
        const { sessionId, paths } = (await req.json().catch(() => ({}))) as { sessionId?: string; paths?: string[] };
        try {
          const cwd = await requestCwd(sessionId);
          await discardPaths(cwd, paths ?? []);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/init": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await init(cwd);
          return Response.json(await getStatus(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/branches": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json(await listBranches(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/checkout": {
      POST: async (req) => {
        const { sessionId, branch } = (await req.json().catch(() => ({}))) as { sessionId?: string; branch?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await checkout(cwd, branch ?? "");
          return Response.json(await getStatus(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/push": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await push(cwd);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/pull": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await pull(cwd);
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/fetch": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          await fetchRemotes(await requestCwd(sessionId));
          return Response.json({ ok: true });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stashes": {
      GET: async (req) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId");
        try {
          const cwd = await requestCwd(sessionId);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stash": {
      POST: async (req) => {
        const { sessionId, message, includeUntracked } = (await req.json().catch(() => ({}))) as {
          sessionId?: string;
          message?: string;
          includeUntracked?: boolean;
        };
        try {
          const cwd = await requestCwd(sessionId);
          await stash(cwd, message, includeUntracked !== false);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stash/pop": {
      POST: async (req) => {
        const { sessionId } = (await req.json().catch(() => ({}))) as { sessionId?: string };
        try {
          const cwd = await requestCwd(sessionId);
          await stashPop(cwd);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/git/stash/drop": {
      POST: async (req) => {
        const { sessionId, index } = (await req.json().catch(() => ({}))) as { sessionId?: string; index?: number };
        try {
          const cwd = await requestCwd(sessionId);
          await stashDrop(cwd, index ?? -1);
          return Response.json(await listStashes(cwd));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },

    // ── Filesystem (files panel) ─────────────────────────────────
    // The server resolves the active workspace from sessionId. Paths may be
    // absolute or workspace-relative; canonical paths outside it are rejected.
    // `/api/fs/open` is the one exception: it opens whatever path it's given
    // (relative to the workspace, `~/…`, or absolute), like the terminal.
    "/api/fs/list": {
      GET: async (req) => {
        const url = new URL(req.url);
        const path = url.searchParams.get("path") ?? undefined;
        const sessionId = url.searchParams.get("sessionId");
        try {
          return Response.json(await listDirectory(path, await requestCwd(sessionId)));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/fs/search": {
      GET: async (req) => {
        const url = new URL(req.url);
        const q = url.searchParams.get("q") ?? "";
        const sessionId = url.searchParams.get("sessionId");
        try {
          return Response.json({ entries: await searchFiles(q, 60, await requestCwd(sessionId)) });
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
    "/api/fs/open": {
      GET: async (req) => {
        const url = new URL(req.url);
        const path = url.searchParams.get("path") ?? "";
        const sessionId = url.searchParams.get("sessionId");
        if (!path) return Response.json({ error: "path is required" }, { status: 400 });
        try {
          return Response.json(await openFile(path, await requestCwd(sessionId), getFileEditor()));
        } catch (err) {
          return fsErrorResponse(err);
        }
      },
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url);

    // PTY WebSocket — /ws/pty/:ptyId. Checked first so it doesn't get
    // eaten by the generic /ws/:sessionId match below.
    const ptyMatch = url.pathname.match(/^\/ws\/pty\/([^/]+)$/);
    if (ptyMatch) {
      const ptyId = ptyMatch[1]!;
      if (!hasPty(ptyId)) {
        return new Response("PTY not found", { status: 404 });
      }
      const data: PtyWsData = { protocol: "pty", ptyId, handler: ptyWsHandler };
      const success = server.upgrade(req, { data });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // AI session WebSocket — /ws/:sessionId.
    const sessionMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (sessionMatch) {
      const data: SessionWsData = {
        protocol: "session",
        sessionId: sessionMatch[1]!,
        handler: sessionWsHandler,
      };
      const success = server.upgrade(req, { data });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // ── Static web app (production) ─────────────────────────────
    // Serve the built SPA from `packages/web/dist`. Dev uses Vite instead.
    const webRoot = join(import.meta.dir, "..", "..", "web", "dist");
    const webIndex = Bun.file(join(webRoot, "index.html"));

    const serveWeb = async (url: URL): Promise<Response | null> => {
      if (!(await webIndex.exists())) return null;
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(join(webRoot, pathname));
      if (await file.exists()) return new Response(file);
      // SPA fallback: any unknown path serves the app shell.
      return new Response(webIndex, { headers: { "Content-Type": "text/html" } });
    };

    if (req.method === "GET" || req.method === "HEAD") {
      const web = await serveWeb(url);
      if (web) return web;
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    // `data` here declares the ws.data type for the callbacks below.
    data: {} as WsData,
    async open(ws) {
      diagnosticsLogger.emit({
        level: "debug",
        scope: "server.ws",
        msg: "socket open",
        extra: { protocol: ws.data.protocol },
      });
      try {
        await ws.data.handler.open(ws);
      } catch (error) {
        diagnosticsLogger.emit(errorEvent("socket open failed", error, "server.ws"));
        throw error;
      }
    },
    async message(ws, message) {
      try {
        await ws.data.handler.message(ws, message);
      } catch (error) {
        diagnosticsLogger.emit(errorEvent("socket message failed", error, "server.ws"));
        throw error;
      }
    },
    close(ws, code, reason) {
      try {
        ws.data.handler.close(ws);
      } finally {
        diagnosticsLogger.emit({
          level: "debug",
          scope: "server.ws",
          msg: "socket close",
          extra: { protocol: ws.data.protocol, code, reason: reason.toString() },
        });
      }
    },
  },
});

bootLogger.emit({
  scope: "server.boot",
  msg: `listening on http://${hostname}:${configuredPort}`,
  extra: { hostname, port: configuredPort },
});

// Best-effort cleanup on shutdown. Useful when Bun restarts in --hot mode.
const shutdown = () => {
  stopAllPtys();
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
