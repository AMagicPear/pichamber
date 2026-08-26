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
});
