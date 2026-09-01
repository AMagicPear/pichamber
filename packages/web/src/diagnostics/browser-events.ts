/**
 * High-level browser diagnostics recorder.
 *
 * Captures global error events (uncaught exceptions, unhandled rejections,
 * Vue errors, WebSocket lifecycle) into the IndexedDB event ring. The
 * capture is opt-in via `installDiagnostics` so tests / Storybook can skip
 * it without paying for the IndexedDB dependency.
 *
 * Captured events never include prompt content, model output, or any
 * payload bodies. The browser only records structural facts: "WS opened",
 * "operation started", "Vue error". Stack traces that happen to contain
 * user code are kept because they're how an operator localises a crash.
 */
import {
  type DiagnosticEvent,
  type DiagnosticLevel,
  redactPath,
  serializeError,
} from "@amagicpear/pichamber-shared";
import {
  currentLevel,
  openDiagnosticsStore,
  setDiagnosticsLevel,
  type DiagnosticsStore,
} from "./event-store";
import type { App } from "vue";

const CLIENT_INSTANCE_KEY = "pichamber.diagnostics.client-instance.v1";
const LAST_CLEAN_EXIT_KEY = "pichamber.diagnostics.last-clean-exit.v1";

/** A new id is assigned per page lifetime. The active and clean ids live in
 * localStorage so the next load can identify a previous page that did not
 * reach pagehide (renderer crash, forced browser quit, or process kill). */
const createInstanceId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readPreviousInstanceId = (): string | null => {
  if (typeof localStorage === "undefined") return "ssr";
  return localStorage.getItem(CLIENT_INSTANCE_KEY);
};

/** Read the URL `?log=…` override once at startup. Useful while
 *  developing; production code is fine with the default `info` level. */
const readUrlLevel = (): DiagnosticLevel => {
  if (typeof location === "undefined") return "info";
  const value = new URLSearchParams(location.search).get("log")?.toLowerCase();
  return value === "debug" || value === "info" || value === "warn" || value === "error" || value === "fatal"
    ? value
    : "info";
};

const writeCleanExit = (instanceId: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LAST_CLEAN_EXIT_KEY, instanceId);
};

const readCleanExit = (): string | null => {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(LAST_CLEAN_EXIT_KEY);
};

const sanitizePath = (input: string): string => {
  const redacted = redactPath(input);
  return typeof redacted === "string" ? redacted : input;
};

export type DiagnosticsHandle = {
  record: (event: Omit<DiagnosticEvent, "v" | "ts" | "clientInstanceId"> & { level?: DiagnosticLevel }) => void;
  child: (context: { scope: string; sessionId?: string; operationId?: string }) => DiagnosticsHandle;
  store: DiagnosticsStore;
  installGlobalHandlers: (app?: App) => () => void;
};

const buildEvent = (
  partial: Omit<DiagnosticEvent, "v" | "ts" | "clientInstanceId"> & { level?: DiagnosticLevel },
  instanceId: string,
): DiagnosticEvent => ({
  v: 1,
  ts: new Date().toISOString(),
  level: partial.level ?? "info",
  scope: partial.scope,
  msg: partial.msg,
  ...(partial.sessionId !== undefined ? { sessionId: partial.sessionId } : {}),
  ...(partial.connectionId !== undefined ? { connectionId: partial.connectionId } : {}),
  ...(partial.operationId !== undefined ? { operationId: partial.operationId } : {}),
  ...(partial.extra !== undefined ? { extra: partial.extra } : {}),
  ...(partial.err !== undefined ? { err: partial.err } : {}),
  clientInstanceId: instanceId,
});

export const installDiagnostics = async (): Promise<DiagnosticsHandle> => {
  const previousInstanceId = readPreviousInstanceId();
  const instanceId = createInstanceId();
  setDiagnosticsLevel(readUrlLevel());
  const store = await openDiagnosticsStore();
  const previousCleanExit = readCleanExit();
  if (previousInstanceId !== null && previousCleanExit !== previousInstanceId) {
    store
      .insert({
        v: 1,
        ts: new Date().toISOString(),
        level: "warn",
        scope: "web.diagnostics",
        msg: "Previous browser session ended unexpectedly",
        clientInstanceId: instanceId,
      })
      .catch(() => undefined);
  }
  if (typeof localStorage !== "undefined") localStorage.setItem(CLIENT_INSTANCE_KEY, instanceId);

  const record = (event: Omit<DiagnosticEvent, "v" | "ts" | "clientInstanceId"> & { level?: DiagnosticLevel }) => {
    if (event.level !== undefined) {
      // Respect the user's URL-driven threshold even for explicit levels
      // (e.g. an explicit "error" still has to pass the configured level).
      const order: DiagnosticLevel[] = ["debug", "info", "warn", "error", "fatal"];
      if (order.indexOf(event.level) < order.indexOf(currentLevel())) return;
    }
    store.insert(buildEvent(event, instanceId)).catch(() => undefined);
  };

  const child = (context: { scope: string; sessionId?: string; operationId?: string }): DiagnosticsHandle => ({
    record: (event) => record({ ...event, ...context, scope: `${context.scope}.${event.scope}` }),
    child,
    store,
    installGlobalHandlers,
  });

  const installGlobalHandlers = (app?: App) => {
    const onError = (event: ErrorEvent) => {
      record({
        level: "error",
        scope: "web.window",
        msg: event.message || "Uncaught error",
        extra: { filename: sanitizePath(event.filename ?? ""), line: event.lineno, column: event.colno },
        err: serializeError(event.error ?? new Error(event.message)),
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      record({
        level: "error",
        scope: "web.window",
        msg: "Unhandled promise rejection",
        err: serializeError(event.reason),
      });
    };
    const onVisibility = () => {
      record({
        level: "debug",
        scope: "web.window",
        msg: document.visibilityState === "hidden" ? "page hidden" : "page visible",
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", () => writeCleanExit(instanceId), { once: true });

    let previousVueHandler: App["config"]["errorHandler"];
    if (app?.config) {
      previousVueHandler = app.config.errorHandler;
      app.config.errorHandler = (err, instance, info) => {
        record({
          level: "error",
          scope: "web.vue",
          msg: info || "Vue error",
          err: serializeError(err),
        });
        previousVueHandler?.(err, instance, info);
      };
    }

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
      if (app?.config) app.config.errorHandler = previousVueHandler ?? (() => undefined);
      writeCleanExit(instanceId);
    };
  };

  record({ level: "info", scope: "web.boot", msg: "browser diagnostics installed" });

  return {
    record,
    child,
    store,
    installGlobalHandlers,
  };
};

let cached: DiagnosticsHandle | null = null;

export const getDiagnostics = async (): Promise<DiagnosticsHandle> => {
  if (cached) return cached;
  cached = await installDiagnostics();
  return cached;
};

// Re-exported for Settings UI.

export const __testHooks = { createInstanceId, readPreviousInstanceId, writeCleanExit, readCleanExit };
