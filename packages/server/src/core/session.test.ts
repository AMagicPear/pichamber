import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSdkDriver, hasUsableSessionCwd } from "./session";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("session driver creation", () => {
  test("recognizes only existing directories as usable session working directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "pichamber-session-"));
    temporaryDirectories.push(root);
    const project = join(root, "project");
    await mkdir(project);

    expect(hasUsableSessionCwd(project)).toBe(true);
    expect(hasUsableSessionCwd(join(root, "deleted-project"))).toBe(false);
  });

  test("preserves a new session's manager, id, and cwd before the file exists", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "pichamber-session-"));
    temporaryDirectories.push(sessionDirectory);
    const cwd = join(sessionDirectory, "project");
    const manager = SessionManager.create(cwd, sessionDirectory);
    const sessionFile = manager.getSessionFile();
    const driver = createSdkDriver(manager);

    expect(sessionFile).toBeDefined();
    expect(driver.sessionId).toBe(manager.getSessionId());
    expect(driver.cwd).toBe(cwd);
    expect(driver.sessionFile).toBe(sessionFile!);
  });

  test("extracts a selected message path without changing the source session", async () => {
    const root = await mkdtemp(join(tmpdir(), "pichamber-session-"));
    temporaryDirectories.push(root);
    const manager = SessionManager.create(root, root);
    const firstId = manager.appendMessage({ role: "user", content: "first", timestamp: Date.now() });
    const secondId = manager.appendMessage({ role: "assistant", content: [], timestamp: Date.now(), provider: "test", model: "test", api: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" });
    const thirdId = manager.appendMessage({ role: "user", content: "later", timestamp: Date.now() });
    const sourceFile = manager.getSessionFile()!;

    const forkFile = SessionManager.open(sourceFile).createBranchedSession(secondId)!;
    const fork = SessionManager.open(forkFile);

    expect(fork.getBranch().map((entry) => entry.id)).toEqual([firstId, secondId]);
    expect(manager.getBranch().map((entry) => entry.id)).toEqual([firstId, secondId, thirdId]);
  });

  test("copies a persisted session into another project directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pichamber-session-"));
    temporaryDirectories.push(root);
    const sourceCwd = join(root, "source");
    const targetCwd = join(root, "target");
    const sessionDir = join(root, "sessions");
    await Promise.all([mkdir(sourceCwd), mkdir(targetCwd)]);
    const source = SessionManager.create(sourceCwd, sessionDir);
    source.appendMessage({ role: "user", content: "copy this", timestamp: Date.now() });
    source.appendMessage({ role: "assistant", content: [], timestamp: Date.now(), provider: "test", model: "test", api: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" });
    const sourceFile = source.getSessionFile()!;

    const copy = SessionManager.forkFrom(sourceFile, targetCwd, sessionDir);

    expect(copy.getCwd()).toBe(targetCwd);
    expect(copy.getHeader()?.parentSession).toBe(sourceFile);
    expect(copy.getBranch().map((entry) => entry.type)).toEqual(["message", "message"]);
  });
});
