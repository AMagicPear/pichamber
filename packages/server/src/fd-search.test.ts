import { afterEach, describe, expect, test } from "bun:test";
import { fdSearch, isFdAvailable, resetFdPathCache } from "./services/fd-search";

const originalPath = process.env.PATH;
afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  resetFdPathCache();
});

describe("fd-search", () => {
  test("uses the deterministic unavailable fallback without fd on PATH", async () => {
    process.env.PATH = "";
    expect(isFdAvailable()).toBe(false);
    const ac = new AbortController();
    expect(await fdSearch("alpha", "/workspace", ac.signal)).toBe("unavailable");
  });
});
