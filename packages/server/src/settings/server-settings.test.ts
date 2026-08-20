import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(async () => {
  // Clear module cache so each test re-reads the env vars.
  for (const path of roots.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
  delete process.env.PICHAMBER_SETTINGS_DIR;
  // Reset cached settings between tests.
  const { resetServerSettingsForTests } = await import("./server-settings");
  resetServerSettingsForTests();
});

const useTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pichamber-settings-"));
  roots.push(dir);
  process.env.PICHAMBER_SETTINGS_DIR = dir;
  return dir;
};

const importSettings = async () => {
  const path = "./server-settings?test=" + Math.random();
  return import(path);
};

describe("server-settings persistence", () => {
  test("returns defaults when no file exists", async () => {
    await useTempDir();
    const { getServerSettings } = await importSettings();
    expect(getServerSettings()).toEqual({ useExternalPi: false, externalPiPath: "" });
  });

  test("loads persisted settings from disk", async () => {
    const dir = await useTempDir();
    await writeFile(join(dir, "server.json"), JSON.stringify({ useExternalPi: true, externalPiPath: "/opt/pi" }));
    const { getServerSettings } = await importSettings();
    expect(getServerSettings()).toEqual({ useExternalPi: true, externalPiPath: "/opt/pi" });
  });

  test("saveServerSettings merges partial updates and writes to disk", async () => {
    const dir = await useTempDir();
    const { saveServerSettings, getServerSettings } = await importSettings();
    saveServerSettings({ useExternalPi: true });
    expect(getServerSettings().useExternalPi).toBe(true);
    expect(getServerSettings().externalPiPath).toBe(""); // unchanged
    const persisted = JSON.parse(await Bun.file(join(dir, "server.json")).text());
    expect(persisted).toEqual({ useExternalPi: true, externalPiPath: "" });

    saveServerSettings({ externalPiPath: "/usr/local/bin/pi" });
    expect(getServerSettings()).toEqual({ useExternalPi: true, externalPiPath: "/usr/local/bin/pi" });
  });

  test("falls back to defaults when the file is corrupt", async () => {
    const dir = await useTempDir();
    await writeFile(join(dir, "server.json"), "{not valid json");
    const { getServerSettings } = await importSettings();
    expect(getServerSettings()).toEqual({ useExternalPi: false, externalPiPath: "" });
  });

  test("resolveExternalPi returns null when the option is off", async () => {
    await useTempDir();
    const { resolveExternalPi } = await importSettings();
    expect(resolveExternalPi()).toBeNull();
  });

  test("resolveExternalPi searches $PATH when the field is empty", async () => {
    const dir = await useTempDir();
    const binary = join(dir, "pichamber-test-bin");
    await writeFile(binary, "");
    process.env.PATH = dir;
    const { saveServerSettings, resolveExternalPi } = await importSettings();
    saveServerSettings({ useExternalPi: true, externalPiPath: "pichamber-test-bin" });
    expect(resolveExternalPi()).toBe(binary);
  });

  test("resolveExternalPi returns null when the bare name isn't on PATH", async () => {
    await useTempDir();
    const { saveServerSettings, resolveExternalPi } = await importSettings();
    saveServerSettings({ useExternalPi: true, externalPiPath: "definitely-not-a-real-binary-1234" });
    expect(resolveExternalPi()).toBeNull();
  });

  test("resolveExternalPi returns null for absolute path that doesn't exist", async () => {
    await useTempDir();
    const { saveServerSettings, resolveExternalPi } = await importSettings();
    saveServerSettings({ useExternalPi: true, externalPiPath: "/nonexistent/path/pi" });
    expect(resolveExternalPi()).toBeNull();
  });

  test("resolveExternalPi accepts an absolute path that exists", async () => {
    const dir = await useTempDir();
    const binary = join(dir, "pi");
    await writeFile(binary, "");
    const { saveServerSettings, resolveExternalPi } = await importSettings();
    saveServerSettings({ useExternalPi: true, externalPiPath: binary });
    expect(resolveExternalPi()).toBe(binary);
  });
});
