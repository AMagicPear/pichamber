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

  test("exposes the orcarouter built-in", () => {
    const def = getBuiltinExtension("orcarouter");
    expect(def.name).toBe("OrcaRouter");
    expect(existsSync(join(def.sourceDir, "index.ts"))).toBe(true);
    expect(existsSync(join(def.sourceDir, "package.json"))).toBe(true);
  });

  test("orcarouter source registers the provider with the gateway base URL", () => {
    const source = readFileSync(join(getBuiltinExtension("orcarouter").sourceDir, "index.ts"), "utf8");
    expect(source).toContain("pi.registerProvider(ORCAROUTER_PROVIDER_ID, config)");
    expect(source).toContain("https://api.orcarouter.ai/v1");
    expect(source).toContain("capability=chat");
  });

  test("exposes the apply-patch built-in with its source files", () => {
    const def = getBuiltinExtension("apply-patch");
    expect(def.name).toBe("Apply Patch");
    expect(def.files).toEqual([
      "index.ts",
      "package.json",
      "src/index.ts",
      "src/write-file-atomic.ts",
      "LICENSE",
      "NOTICE",
    ]);
    expect(installedExtensionPath(def.id)).toContain("/pichamber-apply-patch");
    expect(existsSync(join(def.sourceDir, "src/index.ts"))).toBe(true);
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

  test("installs the apply-patch source tree", () => {
    const def = getBuiltinExtension("apply-patch");
    const agentDir = mkdtempSync(join(tmpdir(), "pichamber-builtin-apply-patch-"));
    try {
      installBuiltinExtension(def, agentDir);
      const target = installedExtensionPath(def.id, agentDir);
      expect(existsSync(join(target, "index.ts"))).toBe(true);
      expect(existsSync(join(target, "package.json"))).toBe(true);
      expect(existsSync(join(target, "src/index.ts"))).toBe(true);
      expect(existsSync(join(target, "src/write-file-atomic.ts"))).toBe(true);
      expect(existsSync(join(target, "LICENSE"))).toBe(true);
      expect(existsSync(join(target, "NOTICE"))).toBe(true);
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
