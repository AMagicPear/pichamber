import { basename, dirname, isAbsolute } from "node:path";
import type {
  ExtensionsOverview,
  LoadedExtensionInfo,
  LoadedSkillInfo,
  SkillsOverview,
} from "@amagicpear/pichamber-shared";
import { SdkSessionDriver } from "../core/driver";
import { getSessionDriver } from "../core/session";
import { refreshSessionModelState } from "../core/ws";
import { RuntimeModeError, toMessage } from "../error";
import {
  getBuiltinExtension,
  installBuiltinExtension,
  installedExtensionPath,
  listBuiltinExtensions,
  removeBuiltinExtension,
} from "../extensions/builtin-extensions";
import { searchPiMarketplace } from "../extensions/marketplace";
import {
  checkPiExtensionUpdates,
  installPiExtensionSource,
  listPiExtensionSources,
  removePiExtensionSource,
  updatePiExtensions,
} from "../extensions/pi-extensions";
import { getExecutionBackend } from "../settings/app-config";
import { getMcpOverview, setMcpServerEnabled } from "../settings/mcp-config";
import {
  getPiBehaviorSettings,
  listPiProviders,
  removePiProviderCredential,
  setPiProviderApiKey,
  updatePiBehaviorSettings,
} from "../settings/pi-config";
import {
  badRequest,
  getDisabledSkills,
  getSdkSession,
  sessionIdFrom,
  withSdkSession,
  type Routes,
} from "./http";

type Paths =
  | "/api/pi/providers"
  | "/api/pi/providers/:provider/credential"
  | "/api/pi/behavior"
  | "/api/pi/extensions"
  | "/api/pi/extensions/overview"
  | "/api/pi/extensions/updates"
  | "/api/pi/extensions/marketplace"
  | "/api/pi/extensions/builtins"
  | "/api/pi/extensions/builtins/:id"
  | "/api/pi/skills/overview"
  | "/api/pi/skills/enabled"
  | "/api/pi/skills/commands"
  | "/api/pi/mcp/overview"
  | "/api/pi/mcp/:name/enabled"
  | "/api/pi/mcp/:name/reconnect";

export const piRoutes: Routes<Paths> = {
  "/api/pi/providers": {
    GET: (req) => withSdkSession(req, (session) => Response.json({ providers: listPiProviders(session) })),
  },

  "/api/pi/providers/:provider/credential": {
    PUT: (req) =>
      withSdkSession(req, async (session, _cwd, sessionId) => {
        const body = (await req.json().catch(() => ({}))) as { apiKey?: unknown };
        if (typeof body.apiKey !== "string" || !body.apiKey.trim()) return badRequest("apiKey required");
        const providers = await setPiProviderApiKey(session, req.params.provider, body.apiKey.trim());
        refreshSessionModelState(sessionId);
        return Response.json({ providers });
      }),
    DELETE: (req) =>
      withSdkSession(req, async (session, _cwd, sessionId) => {
        const providers = await removePiProviderCredential(session, req.params.provider);
        refreshSessionModelState(sessionId);
        return Response.json({ providers });
      }),
  },

  "/api/pi/behavior": {
    GET: async (req) => {
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return badRequest("sessionId required");
      const driver = await getSessionDriver(sessionId);
      if (!driver) return Response.json({ error: "session not found" }, { status: 404 });
      if (!(driver instanceof SdkSessionDriver)) {
        return Response.json({ error: new RuntimeModeError("sdk").message }, { status: 409 });
      }
      return Response.json(getPiBehaviorSettings(driver.session));
    },
    PUT: async (req) => {
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return badRequest("sessionId required");
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
    GET: (req) =>
      withSdkSession(req, (session, cwd) => Response.json({ sources: listPiExtensionSources(session, cwd) })),
    POST: (req) =>
      withSdkSession(req, async (session, cwd) => {
        const body = (await req.json().catch(() => ({}))) as { source?: unknown; scope?: unknown };
        if (typeof body.source !== "string" || !body.source.trim()) return badRequest("source required");
        const sources = await installPiExtensionSource(session, cwd, body.source.trim(), body.scope === "project");
        return Response.json({ sources });
      }),
    DELETE: (req) =>
      withSdkSession(req, async (session, cwd) => {
        const body = (await req.json().catch(() => ({}))) as { source?: unknown; scope?: unknown };
        if (typeof body.source !== "string" || !body.source.trim()) return badRequest("source required");
        const sources = await removePiExtensionSource(session, cwd, body.source.trim(), body.scope === "project");
        return Response.json({ sources });
      }),
  },

  "/api/pi/extensions/overview": {
    GET: (req) =>
      withSdkSession(req, (session, cwd) => {
        const resources = session.resourceLoader.getExtensions();
        const sources = listPiExtensionSources(session, cwd);
        const builtins = listBuiltinExtensions();
        const overview: ExtensionsOverview = {
          builtins,
          sources,
          loaded: resources.extensions.map((extension) => {
            const builtinMatch = builtins.find(
              (b) => extension.path === installedExtensionPath(b.id) || extension.path.startsWith(`${installedExtensionPath(b.id)}/`),
            );
            const entry: LoadedExtensionInfo = {
              label:
                builtinMatch?.name ??
                (extension.sourceInfo.source === "auto" ? basename(dirname(extension.path)) : extension.sourceInfo.source),
              path: extension.path,
              source: extension.sourceInfo.source,
              scope: extension.sourceInfo.scope,
              origin: extension.sourceInfo.origin,
              commands: [...extension.commands.keys()],
              tools: [...extension.tools.keys()],
            };
            if (builtinMatch) entry.builtinId = builtinMatch.id;
            return entry;
          }),
          diagnostics: resources.errors,
          inventoryAvailable: true,
        };
        return Response.json(overview);
      }),
  },

  "/api/pi/extensions/updates": {
    GET: (req) =>
      withSdkSession(req, async (session, cwd) =>
        Response.json({ updates: await checkPiExtensionUpdates(session, cwd) }),
      ),
    POST: (req) =>
      withSdkSession(req, async (session, cwd) => {
        const body = (await req.json().catch(() => ({}))) as { source?: unknown };
        if (body.source !== undefined && typeof body.source !== "string") {
          return badRequest("source must be a string");
        }
        await updatePiExtensions(session, cwd, body.source?.trim() || undefined);
        await session.reload();
        return Response.json({ updates: await checkPiExtensionUpdates(session, cwd) });
      }),
  },

  "/api/pi/extensions/marketplace": {
    GET: async (req) => {
      const url = new URL(req.url);
      const raw = url.searchParams.get("page") ?? "1";
      try {
        const page = Math.max(1, Math.floor(Number(raw)) || 1);
        return Response.json(
          await searchPiMarketplace({
            name: url.searchParams.get("name") ?? "",
            type: url.searchParams.get("type") ?? "",
            sort: url.searchParams.get("sort") ?? "downloads",
            page,
          }),
        );
      } catch (error) {
        return badRequest(toMessage(error));
      }
    },
  },

  "/api/pi/extensions/builtins": {
    GET: () => Response.json({ builtins: listBuiltinExtensions() }),
  },

  "/api/pi/extensions/builtins/:id": {
    PUT: async (req) => {
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return badRequest("sessionId required");
      const body = (await req.json().catch(() => ({}))) as { install?: unknown };
      if (typeof body.install !== "boolean") return badRequest("install (boolean) required");
      try {
        const def = getBuiltinExtension(req.params.id);
        if (body.install) installBuiltinExtension(def);
        else removeBuiltinExtension(def);

        // 配置后重新加载当前 SDK 会话，让新扩展立即生效并刷新资源快照。
        const result = await getSdkSession(sessionId);
        if ("error" in result) return Response.json({ builtins: listBuiltinExtensions() });
        await result.session.reload();
        return Response.json({ builtins: listBuiltinExtensions() });
      } catch (error) {
        return badRequest(toMessage(error));
      }
    },
  },

  "/api/pi/skills/overview": {
    GET: (req) =>
      withSdkSession(req, (session, cwd) => {
        const resources = session.resourceLoader.getSkills();
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
          disabledSkills: getDisabledSkills(session.settingsManager.getSkillPaths(), cwd),
          diagnostics: resources.diagnostics.map((diagnostic) => ({
            path: diagnostic.path ?? "(unknown)",
            error: diagnostic.message,
          })),
          enableSkillCommands: session.settingsManager.getEnableSkillCommands(),
          inventoryAvailable: true,
        };
        return Response.json(overview);
      }),
  },

  "/api/pi/skills/enabled": {
    PUT: (req) =>
      withSdkSession(req, async (session) => {
        const body = (await req.json().catch(() => ({}))) as { path?: unknown; enabled?: unknown };
        if (typeof body.path !== "string" || !isAbsolute(body.path) || typeof body.enabled !== "boolean") {
          return badRequest("path (absolute string) and enabled (boolean) required");
        }
        const rule = `-${body.path}`;
        const paths = session.settingsManager.getSkillPaths();
        const nextPaths = body.enabled ? paths.filter((path) => path !== rule) : [...new Set([...paths, rule])];
        session.settingsManager.setSkillPaths(nextPaths);
        await session.settingsManager.flush();
        await session.reload();
        return Response.json({ enabled: body.enabled });
      }),
  },

  "/api/pi/skills/commands": {
    PUT: (req) =>
      withSdkSession(req, async (session) => {
        const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") return badRequest("enabled (boolean) required");
        session.settingsManager.setEnableSkillCommands(body.enabled);
        await session.settingsManager.flush();
        await session.reload();
        return Response.json({ enabled: session.settingsManager.getEnableSkillCommands() });
      }),
  },

  "/api/pi/mcp/overview": {
    GET: (req) => withSdkSession(req, async (_session, cwd) => Response.json(await getMcpOverview(cwd))),
  },

  "/api/pi/mcp/:name/enabled": {
    PUT: (req) =>
      withSdkSession(req, async (session, cwd) => {
        const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") return badRequest("sessionId and enabled (boolean) required");
        await setMcpServerEnabled(cwd, req.params.name, body.enabled);
        await session.reload();
        return Response.json(await getMcpOverview(cwd));
      }),
  },

  "/api/pi/mcp/:name/reconnect": {
    POST: (req) =>
      withSdkSession(req, async (session, cwd) => {
        await session.prompt(`/mcp reconnect ${req.params.name}`);
        return Response.json(await getMcpOverview(cwd));
      }),
  },
};
