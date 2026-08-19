import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBuiltinExtension,
  installBuiltinExtension,
  installedExtensionPath,
  listBuiltinExtensions,
  removeBuiltinExtension,
} from "./builtin-extensions";

describe("builtin extensions", () => {
  test("exposes the ark-agent-plan built-in", () => {
    const def = getBuiltinExtension("ark-agent-plan");
    expect(def.name).toBe("Ark Agent Plan");
    expect(def.sourceDir).toBeTruthy();
  });

  test("throws on unknown id", () => {
    expect(() => getBuiltinExtension("nope")).toThrow("Unknown built-in extension");
  });

  test("install / list / remove round-trip", () => {
    const def = getBuiltinExtension("ark-agent-plan");
    const agentDir = mkdtempSync(join(tmpdir(), "pichamber-builtin-extension-"));
    try {
      expect(listBuiltinExtensions(agentDir).find((e) => e.id === "ark-agent-plan")?.installed).toBe(false);

      installBuiltinExtension(def, agentDir);
      const installed = listBuiltinExtensions(agentDir).find((e) => e.id === "ark-agent-plan");
      expect(installed?.installed).toBe(true);
      const target = installedExtensionPath(def.id, agentDir);
      expect(existsSync(join(target, "index.ts"))).toBe(true);
      expect(existsSync(join(target, "package.json"))).toBe(true);
      expect(readFileSync(join(target, "package.json"), "utf8")).toContain("ark-agent-plan");

      // Configure is also an explicit update, even when the version is unchanged.
      writeFileSync(join(target, "index.ts"), "stale extension");
      installBuiltinExtension(def, agentDir);
      expect(readFileSync(join(target, "index.ts"), "utf8")).not.toBe("stale extension");

      removeBuiltinExtension(def, agentDir);
      expect(listBuiltinExtensions(agentDir).find((e) => e.id === "ark-agent-plan")?.installed).toBe(false);
      expect(existsSync(installedExtensionPath(def.id, agentDir))).toBe(false);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  test("extension source exists under the bundled extensions root", () => {
    const def = getBuiltinExtension("ark-agent-plan");
    expect(existsSync(join(def.sourceDir, "index.ts"))).toBe(true);
    expect(existsSync(join(def.sourceDir, "package.json"))).toBe(true);
  });
});
