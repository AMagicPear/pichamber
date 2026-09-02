/**
 * Local JSONL diagnostics logger for the Bun server.
 *
 * Design goals (cross-references the parent session's plan):
 *  - structured, JSON-per-line, no third-party deps;
 *  - works under `bun --hot` (does not require daemon stdout capture);
 *  - safe-by-default: never throws into the agent flow when log I/O fails;
 *  - bounded retention: 14 days OR 100 MB total, whichever comes first;
 *  - one writer per process; a queue serialises appends so two emitters
 *    cannot interleave bytes on a shared fd;
 *  - LOG_LEVEL (env) selects the threshold at startup; child loggers
 *    inherit but allow per-scope overrides via `setLevel`.
 *
 * The logger does NOT log prompt text, model output, tool input/output,
 * credentials, environment variables, or arbitrary request payloads.
 * `extra` is recorded verbatim; callers whitelist what they pass in.
 */
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  type DiagnosticContext,
  type DiagnosticError,
  type DiagnosticEvent,
  type DiagnosticLevel,
  type DiagnosticSink,
  joinScope,
  meetsLevel,
  safeJsonStringify,
  serializeError,
} from "@amagicpear/pichamber-shared";
import { getDiagnosticsLogDir } from "./paths";

const RETENTION_DAYS = 14;
const RETENTION_BYTES = 100 * 1024 * 1024;
const SCAN_THROTTLE_MS = 30_000;

const parseLevel = (raw: string | undefined): DiagnosticLevel => {
  switch (raw?.toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
    case "fatal":
      return raw.toLowerCase() as DiagnosticLevel;
    default:
      return "info";
  }
};

const isoDay = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const isoTimestamp = (date: Date) => date.toISOString();

type WriteJob = { line: string; file: string };

/** File logger: queue serialises appends, retention cleans up old files. */
export class FileLogger {
  private levelValue: DiagnosticLevel;
  private currentDay: string;
  private currentFile: string;
  private queue: Promise<void> = Promise.resolve();
  private lastScan = 0;
  private ioFailureEmitted = false;

  constructor(initialLevel?: DiagnosticLevel) {
    this.levelValue = initialLevel ?? parseLevel(process.env.LOG_LEVEL);
    const today = isoDay(new Date());
    this.currentDay = today;
    this.currentFile = join(getDiagnosticsLogDir(), `server-${today}.jsonl`);
  }

  get level(): DiagnosticLevel {
    return this.levelValue;
  }

  setLevel(level: DiagnosticLevel): void {
    this.levelValue = level;
  }

  getLevel(): DiagnosticLevel {
    return this.level;
  }

  /** Buffered append with backpressure. Errors are swallowed and rate-limited
   *  so a failing disk can never bubble up into the calling code path. */
  private enqueue(line: string, now: Date): void {
    const day = isoDay(now);
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.currentFile = join(getDiagnosticsLogDir(), `server-${day}.jsonl`);
    }
    const file = this.currentFile;
    const job: WriteJob = { line, file };
    this.queue = this.queue.then(() => this.flush(job)).catch(() => undefined);
  }

  private async flush(job: WriteJob): Promise<void> {
    try {
      await mkdir(getDiagnosticsLogDir(), { recursive: true });
      await appendFile(job.file, `${job.line}\n`, "utf8");
      await this.maybeEnforceRetention();
    } catch (error) {
      this.reportIoFailure(error);
    }
  }

  private reportIoFailure(error: unknown): void {
    if (this.ioFailureEmitted) return;
    this.ioFailureEmitted = true;
    // Fall back to stderr — never to console.error in production because
    // it would be redundant with what we already log here. Stderr is the
    // last-resort channel for the operator.
    try {
      const message = serializeError(error)?.message ?? "diagnostics I/O failure";
      process.stderr.write(`[diagnostics] I/O failure: ${message}\n`);
    } catch {
      /* really last resort */
    }
  }

  private async maybeEnforceRetention(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScan < SCAN_THROTTLE_MS) return;
    this.lastScan = now;
    try {
      await enforceRetention(getDiagnosticsLogDir());
    } catch {
      /* retention failure is non-fatal */
    }
  }

  /** Public for tests: synchronously wait for the queue to drain. */
  async drain(): Promise<void> {
    await this.queue;
  }

  emit(event: Omit<DiagnosticEvent, "v" | "ts" | "level"> & { level?: DiagnosticLevel }): void {
    const level = event.level ?? "info";
    if (!meetsLevel(level, this.level)) return;
    const now = new Date();
    const full: DiagnosticEvent = {
      v: 1,
      ts: isoTimestamp(now),
      level,
      scope: event.scope,
      msg: event.msg,
      ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
      ...(event.connectionId !== undefined ? { connectionId: event.connectionId } : {}),
      ...(event.operationId !== undefined ? { operationId: event.operationId } : {}),
      ...(event.extra !== undefined ? { extra: event.extra } : {}),
      ...(event.err !== undefined ? { err: event.err } : {}),
    };
    this.enqueue(safeJsonStringify(full), now);
  }

  child(context: DiagnosticContext): DiagnosticSink {
    return new ChildLogger(this, context);
  }
}

/** Enforce the day + total-size cap. Oldest day files are deleted first. */
export const enforceRetention = async (dir: string): Promise<void> => {
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((name) => name.startsWith("server-") && name.endsWith(".jsonl"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const dated = entries
    .map((name) => ({ name, day: name.slice("server-".length, -".jsonl".length) }))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const cutoffDay = isoDay(cutoff);
  for (const entry of dated) {
    if (entry.day < cutoffDay) {
      await unlink(join(dir, entry.name)).catch(() => undefined);
    }
  }
  const remaining = (
    await Promise.all(
      dated
        .filter((entry) => entry.day >= cutoffDay)
        .map(async (entry) => {
          try {
            const fileStat = await stat(join(dir, entry.name));
            return { name: entry.name, size: fileStat.size };
          } catch {
            return null;
          }
        }),
    )
  ).filter((entry): entry is { name: string; size: number } => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name));
  let totalBytes = remaining.reduce((acc, file) => acc + file.size, 0);
  for (const file of remaining) {
    if (totalBytes <= RETENTION_BYTES) break;
    try {
      await unlink(join(dir, file.name));
      totalBytes -= file.size;
    } catch {
      /* file may have been removed by another process; ignore */
    }
  }
};

/** Child loggers carry context (scope/ids) but write through their parent. */
class ChildLogger implements DiagnosticSink {
  private readonly parent: FileLogger;
  private readonly context: DiagnosticContext;

  constructor(parent: FileLogger, context: DiagnosticContext) {
    this.parent = parent;
    this.context = context;
  }

  get level(): DiagnosticLevel {
    return this.parent.getLevel();
  }

  setLevel(level: DiagnosticLevel): void {
    this.parent.setLevel(level);
  }

  emit(
    event: Omit<DiagnosticEvent, "v" | "ts" | "level"> & { level?: DiagnosticLevel },
  ): void {
    const scope = joinScope(this.context.scope, event.scope);
    const sessionId = event.sessionId ?? this.context.sessionId;
    const connectionId = event.connectionId ?? this.context.connectionId;
    const operationId = event.operationId ?? this.context.operationId;
    this.parent.emit({
      ...event,
      ...(scope ? { scope } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(connectionId !== undefined ? { connectionId } : {}),
      ...(operationId !== undefined ? { operationId } : {}),
    });
  }

  child(context: DiagnosticContext): DiagnosticSink {
    return new ChildLogger(this.parent, {
      ...this.context,
      ...context,
      scope: joinScope(this.context.scope, context.scope),
    });
  }
}

let sharedLogger: FileLogger | null = null;

/** Process-wide singleton. The server constructs one of these at startup
 *  and passes it through `setSharedLogger` so any module can `getLogger()`
 *  without a global. */
export const setSharedLogger = (logger: FileLogger) => {
  sharedLogger = logger;
};

export const getLogger = (scope = "server"): DiagnosticSink => {
  if (!sharedLogger) {
    // Defensive default — produces JSONL via a fresh FileLogger.
    sharedLogger = new FileLogger();
  }
  return sharedLogger.child({ scope });
};

/** Build a one-shot error event. The caller can re-emit it through any sink. */
export const errorEvent = (
  msg: string,
  err: unknown,
  scope = "server",
): { msg: string; scope: string; err: DiagnosticError } => ({
  msg,
  scope,
  err: serializeError(err) ?? { name: "Error", message: String(err) },
});