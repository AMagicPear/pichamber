/**
 * Global process-wide diagnostics hooks.
 *
 * Installs `uncaughtException` and `unhandledRejection` listeners that
 * funnel into the shared logger. We intentionally do not `process.exit`
 * inside these handlers: the rest of the app keeps running, and the
 * diagnostics file ends up with a definitive "the process died here" line.
 */
import type { DiagnosticSink } from "@amagicpear/pichamber-shared";

export const installGlobalHandlers = (logger: DiagnosticSink): void => {
  process.on("uncaughtException", (error, origin) => {
    logger.emit({
      level: "fatal",
      scope: "server.process",
      msg: "uncaughtException",
      extra: { origin },
      err: { name: error.name, message: error.message, stack: error.stack },
    });
  });
  process.on("unhandledRejection", (reason) => {
    logger.emit({
      level: "fatal",
      scope: "server.process",
      msg: "unhandledRejection",
      err:
        reason instanceof Error
          ? { name: reason.name, message: reason.message, stack: reason.stack }
          : { name: "Error", message: String(reason) },
    });
  });
};