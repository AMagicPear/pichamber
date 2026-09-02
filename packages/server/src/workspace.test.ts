import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalPathInWorkspace,
  canonicalWorkspace,
  isWithinWorkspace,
  resolveInWorkspace,
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

describe("resolveInWorkspace", () => {
  const ws = "/work/project";

  test("passes absolute paths through untouched", () => {
    expect(resolveInWorkspace("/Users/me/foo.png", ws)).toBe("/Users/me/foo.png");
  });

  test("resolves relative paths against the workspace", () => {
    expect(resolveInWorkspace("./assets/foo.png", ws)).toBe("/work/project/assets/foo.png");
    expect(resolveInWorkspace("foo.png", ws)).toBe("/work/project/foo.png");
  });

  test("expands ~/ against the home directory (shell convention), independent of workspace", () => {
    // `~/` is shell-shorthand for `$HOME/…` and must not be re-anchored to
    // the active workspace — otherwise the meaning of `~/foo.png` shifts
    // every time the user switches sessions, which is surprising.
    const home = process.env.HOME ?? require("node:os").homedir();
    expect(resolveInWorkspace("~", ws)).toBe(home);
    expect(resolveInWorkspace("~/foo.png", ws)).toBe(`${home}/foo.png`);
    expect(resolveInWorkspace("~/nested/foo.png", ws)).toBe(`${home}/nested/foo.png`);
  });

  test("falls back to homedir when no workspace is supplied", () => {
    expect(resolveInWorkspace("~/foo.png")).toMatch(/(^|\/)foo\.png$/);
  });
});

