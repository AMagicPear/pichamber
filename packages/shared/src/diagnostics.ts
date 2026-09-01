/**
 * Cross-environment diagnostic event contract.
 *
 * Both the Bun server and the browser write JSON serialisable events with
 * the same shape. The schema is intentionally narrow: the field set is
 * safe-by-default (no payload bodies, no credentials, no file contents),
 * and `extra` is the only place where additional structured context may
 * appear — callers must whitelist keys themselves before passing data
 * through, because this module never silently drops unknown fields.
 *
 * Diagnostics are local-first: events land on disk in the server and in
 * IndexedDB in the browser. Users export a report manually; nothing leaves
 * the device unless the user attaches the export to a bug report.
 */

export type DiagnosticLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type DiagnosticError = {
  name: string;
  message: string;
  /** Multi-line stack trace when available; truncated to `MAX_STACK_CHARS`. */
  stack?: string;
  /** Recursive cause chain (one level deep; deeper chains are flattened). */
  cause?: DiagnosticError;
  /** AggregateError.errors truncated to the first `MAX_AGGREGATE_ERRORS`. */
  errors?: DiagnosticError[];
};

export type DiagnosticEvent = {
  /** Schema version. Bump when the field set or semantics change. */
  v: 1;
  /** ISO 8601 timestamp with millisecond precision (UTC). */
  ts: string;
  level: DiagnosticLevel;
  /** Hierarchical module path, e.g. "server.ws" or "web.sessions". */
  scope: string;
  msg: string;
  sessionId?: string;
  connectionId?: string;
  operationId?: string;
  /** Persistent browser instance id. Present only in web-side events; lets an
   *  operator correlate events from the same tab without server-side state. */
  clientInstanceId?: string;
  /** Caller-supplied, already-scrubbed context. */
  extra?: { [key: string]: unknown };
  /** Serialised error (name/message/cause/aggregate errors retained). */
  err?: DiagnosticError;
};

/** Anything that can carry identifying ids; the logger picks the most recent. */
export type DiagnosticContext = {
  sessionId?: string;
  connectionId?: string;
  operationId?: string;
  /** Optional scope override; merged with the parent's scope on `child`. */
  scope?: string;
};

/** Bounded limits applied during `serializeError`. Centralised so both the
 *  shared module and any embedder agree on the truncation thresholds. */
export const DIAGNOSTIC_LIMITS = {
  MAX_STACK_CHARS: 16_000,
  MAX_CAUSE_DEPTH: 5,
  MAX_AGGREGATE_ERRORS: 16,
  MAX_STRING_CHARS: 8_000,
} as const;

/** Comparator: a numeric or string rank for level ordering. */
const levelRank: Record<DiagnosticLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/** Filter helper — returns true when `level` meets or exceeds `threshold`. */
export const meetsLevel = (level: DiagnosticLevel, threshold: DiagnosticLevel): boolean =>
  levelRank[level] >= levelRank[threshold];

const truncateString = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit)}\u2026 (truncated, ${value.length - limit} chars omitted)`;

/** Per-invocation cycle guard. A module-global WeakSet would carry state
 *  between unrelated serialise calls and silently turn otherwise legitimate
 *  repeated Errors into "(circular error reference)" sentinels. */
const serializeErrorInner = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): DiagnosticError | undefined => {
  if (value === null || value === undefined) return undefined;
  if (depth >= DIAGNOSTIC_LIMITS.MAX_CAUSE_DEPTH) {
    return {
      name: "Error",
      message: "(cause chain truncated)",
    };
  }
  if (value instanceof Error) {
    if (seen.has(value)) {
      return { name: value.name || "Error", message: "(circular error reference)" };
    }
    seen.add(value);
    const causeRaw = (value as { cause?: unknown }).cause;
    const aggregateRaw = (value as { errors?: unknown }).errors;
    const aggregate = Array.isArray(aggregateRaw) ? aggregateRaw : undefined;
    const out: DiagnosticError = {
      name: value.name || "Error",
      message: truncateString(value.message || String(value), DIAGNOSTIC_LIMITS.MAX_STRING_CHARS),
    };
    if (typeof value.stack === "string" && value.stack.length > 0) {
      out.stack = truncateString(value.stack, DIAGNOSTIC_LIMITS.MAX_STACK_CHARS);
    }
    const cause = serializeErrorInner(causeRaw, depth + 1, seen);
    if (cause) out.cause = cause;
    if (aggregate && aggregate.length > 0) {
      const items = aggregate
        .slice(0, DIAGNOSTIC_LIMITS.MAX_AGGREGATE_ERRORS)
        .map((item) => serializeErrorInner(item, depth + 1, seen))
        .filter((item): item is DiagnosticError => Boolean(item));
      if (items.length > 0) out.errors = items;
    }
    return out;
  }
  if (typeof value === "string") {
    return { name: "Error", message: truncateString(value, DIAGNOSTIC_LIMITS.MAX_STRING_CHARS) };
  }
  if (typeof value === "object") {
    try {
      const raw = JSON.stringify(value);
      return {
        name: "Error",
        message: truncateString(raw ?? "(unserialisable object)", DIAGNOSTIC_LIMITS.MAX_STRING_CHARS),
      };
    } catch {
      return { name: "Error", message: "(unserialisable object)" };
    }
  }
  return { name: "Error", message: String(value) };
};

/** Serialise any thrown value into a bounded `DiagnosticError`. The result
 *  is JSON-safe and captures full stack + bounded cause / AggregateError.
 *  The cycle guard is per-invocation, so serialising the same Error twice
 *  in two calls produces two complete records. */
export const serializeError = (value: unknown): DiagnosticError | undefined =>
  serializeErrorInner(value, 0, new WeakSet());

/** Joined scopes: child("server") → child("ws") yields scope "server.ws". */
export const joinScope = (parent: string | undefined, next: string | undefined): string | undefined => {
  if (!parent) return next;
  if (!next) return parent;
  return `${parent}.${next}`;
};

/** Base diagnostic emitter shape. Both server and browser provide their own
 *  implementation; the shared module only defines the contract. */
export type DiagnosticSink = {
  readonly level: DiagnosticLevel;
  emit: (event: Omit<DiagnosticEvent, "v" | "ts" | "level"> & { level?: DiagnosticLevel }) => void;
  child: (context: DiagnosticContext) => DiagnosticSink;
  /** Apply a per-process override; defaults to the sink's `level`. */
  setLevel: (level: DiagnosticLevel) => void;
};

/** Default scrubber for path values. Absolute paths under the home directory
 *  are replaced with a `<home>` placeholder; everything else passes through
 *  (relative paths and short tokens remain readable). The function never
 *  throws on bad input. */
const pathRegex = new RegExp(`(${String.fromCharCode(47)}[^\\s${String.fromCharCode(34)}\`<>|?*]+)`, "g");

const HOME = typeof process !== "undefined" ? process.env?.HOME ?? "" : "";

export const redactPath = (value: unknown): unknown => {
  if (typeof value !== "string" || value.length === 0) return value;
  return value.replace(pathRegex, (segment) => {
    if (HOME && segment.startsWith(HOME)) return `<home>${segment.slice(HOME.length)}`;
    return segment;
  });
};

/** Recursive redactor: walks plain objects/arrays, applies `redactPath` to
 *  string leaves. Other primitives are returned untouched. */
export const redactDiagnosticData = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "(depth-exceeded)";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactPath(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticData(item, depth + 1));
  if (typeof value === "object") {
    const out: { [key: string]: unknown } = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDiagnosticData(val, depth + 1);
    }
    return out;
  }
  return value;
};

/** JSON.stringify with bounded size — caps a value at `limit` characters to
 *  keep log lines from blowing up. Returns a placeholder when the value
 *  cannot be stringified (BigInt cycles, etc.). */
export const safeJsonStringify = (value: unknown, limit = 32_000): string => {
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined) return "(unserialisable)";
    return truncateString(raw, limit);
  } catch {
    return "(unserialisable)";
  }
};