import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionDriverMode } from "../core/driver";

export type FileEditor = "vscode" | "cursor" | "zed" | "webstorm" | "system";
type AppConfig = { version: 1; runtimeMode: SessionDriverMode; fileEditor: FileEditor };

const configPath = join(homedir(), ".pichamber", "settings.json");
let config: AppConfig = { version: 1, runtimeMode: "sdk", fileEditor: "vscode" };
let loaded: Promise<void> | null = null;

export const loadAppConfig = () => {
  loaded ??= (async () => {
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<AppConfig>;
      config = {
        version: 1,
        runtimeMode: parsed.runtimeMode === "rpc" ? "rpc" : "sdk",
        fileEditor:
          parsed.fileEditor === "cursor" ||
          parsed.fileEditor === "zed" ||
          parsed.fileEditor === "webstorm" ||
          parsed.fileEditor === "system"
            ? parsed.fileEditor
            : "vscode",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Failed to read Pichamber settings", error);
    }
  })();
  return loaded;
};

export const getRuntimeMode = () => config.runtimeMode;
export const getFileEditor = () => config.fileEditor;

const saveConfig = async () => {
  await mkdir(join(homedir(), ".pichamber"), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, "utf8");
  await rename(temporaryPath, configPath);
};

export const setRuntimeMode = async (runtimeMode: SessionDriverMode) => {
  config = { ...config, runtimeMode };
  await saveConfig();
};

export const setFileEditor = async (fileEditor: FileEditor) => {
  config = { ...config, fileEditor };
  await saveConfig();
};
