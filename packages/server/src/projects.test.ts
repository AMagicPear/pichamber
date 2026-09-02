import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, rmdir, symlink, writeFile } from "node:fs/promises";
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
    expect(result.requestedPath).toBeNull();
    expect(result.requestedPath).toBeNull();
  });

  test("returns no parent at a filesystem root", async () => {
    const root = process.platform === "win32" ? `${process.cwd().slice(0, 2)}\\` : "/";
    const result = await browseProjectDirectories(root);
    expect(result.parent).toBeNull();
  });

  test("falls back to the nearest existing ancestor when the requested path is gone", async () => {
    const root = await mkdtemp(join(tmpdir(), "pichamber-projects-"));
    roots.push(root);
    const surving = join(root, "surviving");
    await mkdir(surving);
    const gone = join(root, "deleted", "inner");
    await mkdir(gone, { recursive: true });
    await rmdir(gone);
    await rmdir(join(root, "deleted"));

    const result = await browseProjectDirectories(gone);
    expect(result.requestedPath).toBe(gone);
    expect(result.path).toBe(await realpath(root));
    // The entries reflect the ancestor, not the missing deep path.
    expect(result.entries.map((entry) => entry.name)).toContain("surviving");
  });

  test("serves an existing path without flagging fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "pichamber-projects-"));
    roots.push(root);
    const project = join(root, "project");
    await mkdir(project);

    const result = await browseProjectDirectories(project);
    expect(result.requestedPath).toBeNull();
    expect(result.path).toBe(await realpath(project));
  });
});
