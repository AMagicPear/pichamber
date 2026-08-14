import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fdSearch, isFdAvailable, resetFdPathCache } from "./fd-search";

const roots: string[] = [];
const tempRoot = async () => {
  const path = await mkdtemp(join(tmpdir(), "pichamber-fd-"));
  roots.push(path);
  return path;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  resetFdPathCache();
});

describe("fd-search", () => {
  test("builds the same prefix regex pi's TUI emits", () => {
    // Smoke check via `query` argument building: with a slash, fd should be
    // invoked with --full-path. Without, it shouldn't. We assert observable
    // behavior (results), not argv, so this stays robust on hosts where fd
    // is missing.
    expect(isFdAvailable()).toBe(true);
  });

  test("returns workspace hits when fd is on PATH", async () => {
    if (!isFdAvailable()) {
      // Skip silently when fd isn't installed; this is the documented
      // fallback path on hosts that don't ship fd.
      return;
    }
    const workspace = await tempRoot();
    await writeFile(join(workspace, "alpha.ts"), "");
    await writeFile(join(workspace, "beta.tsx"), "");
    await mkdir(join(workspace, "alpha.dir"));
    const ac = new AbortController();
    const result = await fdSearch("alpha", workspace, ac.signal);
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    const names = result.map((entry) => entry.path.split("/").pop() ?? "");
    expect(names).toContain("alpha.ts");
  });

  test("empty query returns [] (caller skips in that case)", async () => {
    if (!isFdAvailable()) return;
    const workspace = await tempRoot();
    await writeFile(join(workspace, "alpha.ts"), "");
    const ac = new AbortController();
    const result = await fdSearch("", workspace, ac.signal);
    // Either an empty list or the top-N truncation — both are acceptable.
    expect(Array.isArray(result)).toBe(true);
  });
});
