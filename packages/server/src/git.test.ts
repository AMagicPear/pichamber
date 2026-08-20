import { describe, expect, test } from "bun:test";
import { parseBranchList, parseStashList, parseStatus } from "./services/git";

describe("parseStatus", () => {
  test("keeps complex paths verbatim", () => {
    expect(parseStatus("## main...origin/main\0?? docs/中文 file.md\0")).toEqual({
      branch: "main",
      changes: [{ path: "docs/中文 file.md", status: "untracked", staged: false }],
    });
  });

  test("uses the destination path for renames", () => {
    expect(parseStatus("## HEAD (no branch)\0R  new name.ts\0old name.ts\0")).toEqual({
      branch: null,
      changes: [{ path: "new name.ts", status: "renamed", staged: true }],
    });
  });

  test("parses an unborn branch", () => {
    expect(parseStatus("## No commits yet on main\0").branch).toBe("main");
  });
});

describe("parseBranchList", () => {
  test("marks the current branch and tags remote refs by refname prefix", () => {
    // %(HEAD) emits `*` for the current branch and a single space otherwise;
    // each field is pipe-separated, so a non-current `main` row starts with
    // ` ` and the current `feature/foo` row starts with `*`.
    const stdout = [
      " |main|origin/main|[ahead 1]|2025-01-01|refs/heads/main",
      "*|feature/foo|||2025-01-02|refs/heads/feature/foo",
      " |origin/main||||refs/remotes/origin/main",
    ].join("\n");
    expect(parseBranchList(stdout)).toEqual({
      current: "feature/foo",
      branches: [
        { name: "main", current: false, upstream: "origin/main", track: "[ahead 1]", date: "2025-01-01", remote: false },
        { name: "feature/foo", current: true, upstream: null, track: "", date: "2025-01-02", remote: false },
        { name: "origin/main", current: false, upstream: null, track: "", date: "", remote: true },
      ],
    });
  });

  test("returns null current on detached HEAD (no `*` row)", () => {
    expect(parseBranchList(" |main|||refs/heads/main").current).toBeNull();
  });
});

describe("parseStashList", () => {
  test("parses refs and stash messages", () => {
    const stdout = [
      "stash@{0}@@WIP on main: 1234567 quick fix",
      "stash@{1}@@WIP on main: 89abcde older work",
    ].join("\n");
    expect(parseStashList(stdout)).toEqual({
      stashes: [
        { index: 0, ref: "stash@{0}", message: "WIP on main: 1234567 quick fix" },
        { index: 1, ref: "stash@{1}", message: "WIP on main: 89abcde older work" },
      ],
    });
  });

  test("preserves @@ inside user-authored messages", () => {
    const stdout = "stash@{0}@@something @@ nested";
    expect(parseStashList(stdout).stashes[0]?.message).toBe("something @@ nested");
  });

  test("skips malformed rows", () => {
    const stdout = ["not-a-stash", "stash@{0}@@real", ""].join("\n");
    expect(parseStashList(stdout).stashes).toHaveLength(1);
  });
});
