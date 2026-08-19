import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalPathInWorkspace,
  canonicalWorkspace,
  isWithinWorkspace,
  WorkspaceError,
} from "./services/workspace";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const tempRoot = async () => {
  const path = await mkdtemp(join(tmpdir(), "pichamber-test-"));
  roots.push(path);
  return path;
};

describe("workspace containment", () => {
  test("accepts descendants but not sibling prefixes", () => {
    expect(isWithinWorkspace("/work/project/src", "/work/project")).toBe(true);
    expect(isWithinWorkspace("/work/project-copy", "/work/project")).toBe(false);
  });

  test("canonicalizes a symlinked workspace", async () => {
    const root = await tempRoot();
    const project = join(root, "project");
    const alias = join(root, "alias");
    await mkdir(project);
    await symlink(project, alias, "dir");
    expect(await canonicalWorkspace(alias)).toBe(await realpath(project));
  });

  test("rejects a symlink that escapes the workspace", async () => {
    const root = await tempRoot();
    const workspace = join(root, "workspace");
    const outside = join(root, "outside.txt");
    await mkdir(workspace);
    await writeFile(outside, "secret");
    await symlink(outside, join(workspace, "escape.txt"));
    await expect(canonicalPathInWorkspace("escape.txt", workspace)).rejects.toBeInstanceOf(WorkspaceError);
  });
});

