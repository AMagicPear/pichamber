import { toMessage } from "../error";
import { getDiagnosticsLogDir } from "../diagnostics/paths";
import { readServerTail } from "../diagnostics/server-tail";
import type { Routes } from "./http";

type Paths = "/api/diagnostics/server";

// Local-only endpoint. The browser pulls a bounded tail of recent JSONL
// events so it can bundle them into a single export. It intentionally avoids
// echoing any user-provided content — the report is built from server-local
// records only.
export const diagnosticsRoutes: Routes<Paths> = {
  "/api/diagnostics/server": {
    GET: async (req) => {
      const raw = Number(new URL(req.url).searchParams.get("tail") ?? "500");
      const tail = Number.isFinite(raw) ? Math.min(5_000, Math.max(1, Math.floor(raw))) : 500;
      try {
        const events = await readServerTail(tail);
        return Response.json({ directory: getDiagnosticsLogDir(), events });
      } catch (error) {
        return Response.json({ directory: getDiagnosticsLogDir(), events: [], error: toMessage(error) });
      }
    },
  },
};
