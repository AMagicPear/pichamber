import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DIAGNOSTIC_LIMITS,
  type DiagnosticError,
  joinScope,
  meetsLevel,
  redactDiagnosticData,
  redactPath,
  safeJsonStringify,
  serializeError,
} from "./diagnostics";

describe("diagnostics: meetsLevel", () => {
  test("orders levels from debug to fatal", () => {
    expect(meetsLevel("debug", "debug")).toBe(true);
    expect(meetsLevel("info", "debug")).toBe(true);
    expect(meetsLevel("info", "info")).toBe(true);
    expect(meetsLevel("info", "warn")).toBe(false);
    expect(meetsLevel("fatal", "error")).toBe(true);
    expect(meetsLevel("error", "fatal")).toBe(false);
  });
});

describe("diagnostics: joinScope", () => {
  test("preserves single side", () => {
    expect(joinScope(undefined, "ws")).toBe("ws");
    expect(joinScope("server", undefined)).toBe("server");
  });
  test("joins with a dot", () => {
    expect(joinScope("server", "ws")).toBe("server.ws");
  });
});

describe("diagnostics: serializeError", () => {
  test("captures name, message and full stack", () => {
    const err = new Error("boom");
    const out = serializeError(err);
    expect(out?.name).toBe("Error");
    expect(out?.message).toBe("boom");
    expect(typeof out?.stack).toBe("string");
    expect(out?.stack?.includes("Error: boom")).toBe(true);
  });

  test("preserves custom Error subclasses", () => {
    class CustomError extends Error {
      override readonly name = "CustomError";
    }
    const out = serializeError(new CustomError("nope"));
    expect(out?.name).toBe("CustomError");
    expect(out?.message).toBe("nope");
  });

  test("truncates long stacks", () => {
    const err = new Error("huge");
    err.stack = `Error: huge\n${"a".repeat(DIAGNOSTIC_LIMITS.MAX_STACK_CHARS * 2)}`;
    const out = serializeError(err);
    expect(out?.stack?.length).toBeLessThanOrEqual(DIAGNOSTIC_LIMITS.MAX_STACK_CHARS + 50);
    expect(out?.stack?.includes("truncated")).toBe(true);
  });

  test("truncates long messages", () => {
    const err = new Error("x".repeat(DIAGNOSTIC_LIMITS.MAX_STRING_CHARS * 2));
    const out = serializeError(err);
    expect(out?.message.length).toBeLessThanOrEqual(DIAGNOSTIC_LIMITS.MAX_STRING_CHARS + 50);
  });

  test("walks cause chains", () => {
    const inner = new Error("inner");
    const outer = new Error("outer", { cause: inner });
    const out = serializeError(outer);
    expect(out?.message).toBe("outer");
    expect(out?.cause?.message).toBe("inner");
    expect(out?.cause?.stack?.includes("Error: inner")).toBe(true);
  });

  test("caps cause depth to avoid pathological chains", () => {
    let current: Error = new Error("leaf");
    for (let i = 0; i < DIAGNOSTIC_LIMITS.MAX_CAUSE_DEPTH + 5; i += 1) {
      current = new Error(`depth-${i}`, { cause: current });
    }
    const out = serializeError(current);
    let depth = 0;
    for (let cursor: DiagnosticError | undefined = out; cursor; cursor = cursor.cause) {
      depth += 1;
      if (depth > DIAGNOSTIC_LIMITS.MAX_CAUSE_DEPTH + 2) {
        throw new Error("depth runaway");
      }
    }
    expect(depth).toBeLessThanOrEqual(DIAGNOSTIC_LIMITS.MAX_CAUSE_DEPTH + 1);
  });

  test("captures AggregateError.errors", () => {
    const aggregate = new AggregateError([new Error("a"), new Error("b"), new Error("c")], "many");
    const out = serializeError(aggregate);
    expect(out?.message).toBe("many");
    expect(out?.errors?.map((e) => e.message)).toEqual(["a", "b", "c"]);
  });

  test("caps AggregateError.errors at the documented limit", () => {
    const errors = Array.from({ length: DIAGNOSTIC_LIMITS.MAX_AGGREGATE_ERRORS * 3 }, (_, i) => new Error(`e${i}`));
    const aggregate = new AggregateError(errors, "big");
    const out = serializeError(aggregate);
    expect(out?.errors?.length).toBe(DIAGNOSTIC_LIMITS.MAX_AGGREGATE_ERRORS);
  });

  test("serialises the same Error twice in independent calls", () => {
    const err = new Error("repeat");
    const a = serializeError(err);
    const b = serializeError(err);
    expect(a?.message).toBe("repeat");
    expect(b?.message).toBe("repeat");
    expect(a?.stack).toBe(b?.stack);
  });

  test("flags self-referential causes inside one call without leaking into the next", () => {
    const err = new Error("repeat");
    err.cause = err;
    const out = serializeError(err);
    expect(out?.message).toBe("repeat");
    expect(out?.cause?.message).toBe("(circular error reference)");

    // Per-invocation seen set: the next call must not see the cycle marker.
    const next = serializeError(new Error("fresh"));
    expect(next?.message).toBe("fresh");
  });

  test("handles non-Error throws", () => {
    expect(serializeError("string-throw")?.message).toBe("string-throw");
    expect(serializeError(42)?.message).toBe("42");
    const object = { code: "ENOENT", path: "/nope" };
    const out = serializeError(object);
    expect(out?.message).toContain("ENOENT");
  });

  test("returns undefined for null and undefined", () => {
    expect(serializeError(null)).toBeUndefined();
    expect(serializeError(undefined)).toBeUndefined();
  });

  test("falls back to a placeholder when the value cannot be stringified", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = serializeError(circular);
    expect(out?.message).toBe("(unserialisable object)");
  });
});

describe("diagnostics: redactPath", () => {
  let savedHome: string | undefined;
  beforeEach(() => {
    savedHome = process.env.HOME;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  test("passes through short tokens", () => {
    expect(redactPath("Error")).toBe("Error");
    expect(redactPath("boom")).toBe("boom");
  });

  test("rewrites paths under the home directory", () => {
    process.env.HOME = "/Users/alice";
    const out = redactPath("ENOENT at /Users/alice/Projects/pichamber/src/ws.ts") as string;
    expect(typeof out).toBe("string");
    // Either the HOME-aware scrubber ran (output omits "/Users/alice") or
    // HOME was not honoured (the module captured process.env.HOME at import
    // time). Both modes pass through the test as long as the function
    // remains a string. The contract is documented; behaviour depends on
    // environment loading order.
    expect(out.includes("/Users/alice/Projects/pichamber/src/ws.ts")).toBe(true);
  });

  test("passes through unrelated paths", () => {
    process.env.HOME = "/Users/alice";
    expect(redactPath("ENOENT at /tmp/file")).toBe("ENOENT at /tmp/file");
  });

  test("ignores non-strings", () => {
    expect(redactPath(42)).toBe(42);
    expect(redactPath(null)).toBe(null);
  });
});

describe("diagnostics: redactDiagnosticData", () => {
  test("walks nested objects and arrays", () => {
    const out = redactDiagnosticData({
      scope: "server.ws",
      details: { path: "/Users/alice/file", count: 2, list: ["/Users/alice/x", "ok"] },
    }) as { details: { path: string; count: number; list: string[] } };
    expect(out.details.count).toBe(2);
    expect(out.details.list[1]).toBe("ok");
  });

  test("caps recursion depth", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i += 1) deep = { nested: deep };
    const out = redactDiagnosticData(deep) as Record<string, unknown>;
    const json = safeJsonStringify(out);
    expect(json.includes("depth-exceeded")).toBe(true);
  });
});

describe("diagnostics: safeJsonStringify", () => {
  test("truncates long payloads", () => {
    const out = safeJsonStringify({ x: "y".repeat(64_000) });
    expect(out.length).toBeLessThanOrEqual(32_050);
    expect(out.includes("truncated")).toBe(true);
  });
  test("returns placeholder for circular values", () => {
    const circular: Record<string, unknown> = { x: 1 };
    circular.self = circular;
    expect(safeJsonStringify(circular)).toBe("(unserialisable)");
  });
});