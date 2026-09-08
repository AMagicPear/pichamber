import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import { instanceId, startedAt, version } from "../config";
import type { Routes } from "./http";

type Paths = "/api/health" | "/api/version";

/** Liveness/version probes. Kept apart from the feature routes so the health
 *  payload never has to import the session runtime. */
export const systemRoutes: Routes<Paths> = {
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
};
