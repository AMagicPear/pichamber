import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browseProjectDirectories } from "./services/projects";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project directory browser", () => {
  test("lists directories only and canonicalizes links", async () => {
    const root = await mkdtemp(join(tmpdir(), "pichamber-projects-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);
    await writeFile(join(root, "notes.txt"), "not a project");
    await symlink(project, join(root, "linked-project"));

    const result = await browseProjectDirectories(root);
    expect(result.entries.map((entry) => entry.name)).toEqual(["linked-project", "project"]);
    expect(result.entries[0]?.path).toBe(await realpath(project));
    expect(result.entries.some((entry) => entry.name === "notes.txt")).toBe(false);
  });

  test("returns no parent at a filesystem root", async () => {
    const root = process.platform === "win32" ? `${process.cwd().slice(0, 2)}\\` : "/";
    const result = await browseProjectDirectories(root);
    expect(result.parent).toBeNull();
  });
});
