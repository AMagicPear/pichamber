import { describe, expect, test } from "bun:test";
import { parseStatus } from "./git";

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
