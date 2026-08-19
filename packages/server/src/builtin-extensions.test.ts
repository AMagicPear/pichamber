import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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
    // Clean any prior state.
    removeBuiltinExtension(def);

    expect(listBuiltinExtensions().find((e) => e.id === "ark-agent-plan")?.installed).toBe(false);

    installBuiltinExtension(def);
    const installed = listBuiltinExtensions().find((e) => e.id === "ark-agent-plan");
    expect(installed?.installed).toBe(true);
    // Files actually landed in the agent dir.
    const target = installedExtensionPath(def.id);
    expect(existsSync(join(target, "index.ts"))).toBe(true);
    expect(existsSync(join(target, "package.json"))).toBe(true);
    expect(readFileSync(join(target, "package.json"), "utf8")).toContain("ark-agent-plan");

    // Idempotent: re-install doesn't error.
    installBuiltinExtension(def);

    removeBuiltinExtension(def);
    expect(listBuiltinExtensions().find((e) => e.id === "ark-agent-plan")?.installed).toBe(false);
    expect(existsSync(installedExtensionPath(def.id))).toBe(false);
  });

  test("extension source exists under the bundled extensions root", () => {
    const def = getBuiltinExtension("ark-agent-plan");
    expect(existsSync(join(def.sourceDir, "index.ts"))).toBe(true);
    expect(existsSync(join(def.sourceDir, "package.json"))).toBe(true);
  });
});
