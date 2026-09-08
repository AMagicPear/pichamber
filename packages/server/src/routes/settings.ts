import { closeSessionSockets } from "../core/ws";
import { switchExecutionBackend } from "../core/session";
import { toMessage } from "../error";
import { getProviderQuota, listQuotaProviders } from "../providers/quota";
import { getExecutionBackend, getFileEditor, loadAppConfig, setFileEditor } from "../settings/app-config";
import { badRequest, withSdkSession, type Routes } from "./http";

type Paths =
  | "/api/settings/execution-backend"
  | "/api/settings/editor"
  | "/api/quota/providers"
  | "/api/quota/:provider";

const FILE_EDITORS = ["vscode", "cursor", "zed", "webstorm", "system"] as const;
type FileEditor = Parameters<typeof setFileEditor>[0];

export const settingsRoutes: Routes<Paths> = {
  "/api/settings/execution-backend": {
    GET: async () => {
      await loadAppConfig();
      return Response.json({ executionBackend: getExecutionBackend() });
    },
    PUT: async (req) => {
      const body = (await req.json().catch(() => ({}))) as { executionBackend?: unknown };
      if (body.executionBackend !== "sdk" && body.executionBackend !== "rpc") {
        return badRequest("executionBackend must be sdk or rpc");
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
      if (!FILE_EDITORS.includes(fileEditor as FileEditor)) {
        return badRequest("unsupported file editor");
      }
      await setFileEditor(fileEditor as FileEditor);
      return Response.json({ fileEditor });
    },
  },

  "/api/quota/providers": {
    GET: (req) => withSdkSession(req, (session) => Response.json({ providers: listQuotaProviders(session) })),
  },

  "/api/quota/:provider": {
    GET: (req) =>
      withSdkSession(
        req,
        async (session) => Response.json(await getProviderQuota(req.params.provider, session)),
        500,
      ),
  },
};
