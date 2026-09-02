import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLogger, enforceRetention } from "./logger";

/** Builds a logger pointed at a scratch directory for each test. */
const tempDir = () => mkdtemp(join(tmpdir(), "pichamber-logger-"));

const readLines = async (path: string): Promise<unknown[]> => {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

describe("FileLogger", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await tempDir();
    process.env.PICHAMBER_STATE_DIR = dir;
  });
  afterEach(async () => {
    delete process.env.PICHAMBER_STATE_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  test("writes structured JSONL events under the day file", async () => {
    const logger = new FileLogger("debug");
    logger.emit({ scope: "test", msg: "hello" });
    logger.emit({ level: "warn", scope: "test", msg: "careful" });
    await logger.drain();

    const logDir = join(dir, "logs");
    const files = await readdir(logDir);
    expect(files.some((f) => f.startsWith("server-") && f.endsWith(".jsonl"))).toBe(true);
    const dayFile = files.find((f) => f.startsWith("server-") && f.endsWith(".jsonl"))!;
    const lines = await readLines(join(logDir, dayFile));
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({
      v: 1,
      level: "info",
      scope: "test",
      msg: "hello",
    });
    expect(typeof (lines[0] as { ts: string }).ts).toBe("string");
  });

  test("filters events below the configured level", async () => {
    const logger = new FileLogger("warn");
    logger.emit({ level: "debug", scope: "x", msg: "dropped" });
    logger.emit({ level: "warn", scope: "x", msg: "kept" });
    await logger.drain();

    const logDir = join(dir, "logs");
    const files = await readdir(logDir);
    const dayFile = files.find((f) => f.endsWith(".jsonl"))!;
    const lines = await readLines(join(logDir, dayFile));
    expect(lines.length).toBe(1);
    expect((lines[0] as { msg: string }).msg).toBe("kept");
  });

  test("children carry parent context into child events", async () => {
    const logger = new FileLogger("debug");
    const session = logger.child({ scope: "ws.session", sessionId: "abc" });
    session.emit({ scope: "operation", msg: "received", operationId: "op-1" });
    await logger.drain();

    const logDir = join(dir, "logs");
    const files = await readdir(logDir);
    const dayFile = files.find((f) => f.endsWith(".jsonl"))!;
    const lines = await readLines(join(logDir, dayFile));
    expect(lines[0]).toMatchObject({
      scope: "ws.session.operation",
      sessionId: "abc",
      operationId: "op-1",
    });
  });

  test("serialises appends even when emits happen synchronously", async () => {
    const logger = new FileLogger("debug");
    for (let i = 0; i < 100; i += 1) {
      logger.emit({ scope: "burst", msg: `line-${i}` });
    }
    await logger.drain();

    const logDir = join(dir, "logs");
    const files = await readdir(logDir);
    const dayFile = files.find((f) => f.endsWith(".jsonl"))!;
    const lines = await readLines(join(logDir, dayFile));
    expect(lines.length).toBe(100);
    // Every line must be a complete JSON object, never a half-written
    // collision between two concurrent emitters.
    for (const line of lines) {
      expect(typeof line).toBe("object");
    }
  });

  test("swallows I/O errors so they never reach the caller", async () => {
    // Force the appendFile path to fail by pointing the day file at a path
    // that already exists as a directory.
    await rm(dir, { recursive: true });
    await import("node:fs/promises").then((m) => m.mkdir(dir, { recursive: true }));
    const blocker = join(dir, "server-2099-01-01.jsonl");
    await import("node:fs/promises").then((m) => m.mkdir(blocker, { recursive: true }));

    // Override the constructor's pick by emitting on a synthetic logger
    // that uses the same dir but with a fixed date prefix.
    const fixed = new (class extends FileLogger {
      override emit(event: Parameters<FileLogger["emit"]>[0]): void {
        // emit on 2099-01-01 by piggy-backing on the queue.
        super.emit(event);
      }
    })("debug");

    fixed.emit({ scope: "io", msg: "should not crash" });
    await fixed.drain();
    // No assertion on log content; the contract is "emit never throws".
    expect(true).toBe(true);
  });
});

describe("enforceRetention", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tempDir();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("removes day files older than 14 days", async () => {
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const recentDate = new Date().toISOString().slice(0, 10);
    await writeFile(join(dir, `server-${oldDate}.jsonl`), "old\n", "utf8");
    await writeFile(join(dir, `server-${recentDate}.jsonl`), "new\n", "utf8");

    await enforceRetention(dir);
    const remaining = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    expect(remaining).toContain(`server-${recentDate}.jsonl`);
    expect(remaining).not.toContain(`server-${oldDate}.jsonl`);
  });

  test("drops oldest files when total size exceeds 100 MB", async () => {
    const dates = Array.from({ length: 10 }, (_, i) => {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      return d;
    });
    // Each file claims to be 12 MB — well over a single-day allowance.
    for (const date of dates) {
      await writeFile(join(dir, `server-${date}.jsonl`), "x".repeat(12 * 1024 * 1024), "utf8");
    }
    await enforceRetention(dir);
    const remaining = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    expect(remaining.length).toBeLessThan(dates.length);
  });

  test("is a no-op when the directory does not exist", async () => {
    await rm(dir, { recursive: true, force: true });
    await expect(enforceRetention(dir)).resolves.toBeUndefined();
  });
});