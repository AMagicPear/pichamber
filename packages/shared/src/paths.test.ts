import { describe, expect, test } from "bun:test";
import { pathBasename, pathDirname, stripParent } from "./paths";

describe("cross-platform display paths", () => {
  test("preserves filesystem roots", () => {
    expect(pathDirname("/foo")).toBe("/");
    expect(pathDirname("C:\\foo")).toBe("C:\\");
    expect(pathBasename("/")).toBe("/");
    expect(pathDirname("\\\\server\\share\\folder")).toBe("\\\\server\\share\\");
  });

  test("strips root and directory parents", () => {
    expect(stripParent("/", "/tmp/file.ts")).toBe("tmp/file.ts");
    expect(stripParent("C:\\", "C:\\tmp\\file.ts")).toBe("tmp\\file.ts");
    expect(stripParent("/work", "/workspace/file.ts")).toBeUndefined();
  });
});
