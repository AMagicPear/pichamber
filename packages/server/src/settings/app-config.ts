import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionDriverMode } from "../core/driver";

type AppConfig = { version: 1; runtimeMode: SessionDriverMode };

const configPath = join(homedir(), ".pichamber", "settings.json");
let config: AppConfig = { version: 1, runtimeMode: "sdk" };
let loaded: Promise<void> | null = null;

export const loadAppConfig = () => {
  loaded ??= (async () => {
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<AppConfig>;
      if (parsed.runtimeMode === "sdk" || parsed.runtimeMode === "rpc") config = { version: 1, runtimeMode: parsed.runtimeMode };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Failed to read Pichamber settings", error);
    }
  })();
  return loaded;
};

export const getRuntimeMode = () => config.runtimeMode;

export const setRuntimeMode = async (runtimeMode: SessionDriverMode) => {
  config = { version: 1, runtimeMode };
  await mkdir(join(homedir(), ".pichamber"), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, "utf8");
  await rename(temporaryPath, configPath);
};
