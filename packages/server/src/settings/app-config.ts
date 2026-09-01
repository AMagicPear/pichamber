import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PiExecutionBackend } from "../core/driver";

export type FileEditor = "vscode" | "cursor" | "zed" | "webstorm" | "system";
type AppConfig = { version: 2; executionBackend: PiExecutionBackend; fileEditor: FileEditor };

const configPath = join(homedir(), ".pichamber", "settings.json");
let config: AppConfig = { version: 2, executionBackend: "sdk", fileEditor: "vscode" };
let loaded: Promise<void> | null = null;

export const loadAppConfig = () => {
  loaded ??= (async () => {
    try {
      const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<AppConfig> & { runtimeMode?: unknown };
      config = {
        version: 2,
        // runtimeMode was the pre-v2 name. Preserve existing local settings
        // while writing the unambiguous executionBackend field from now on.
        executionBackend: (parsed.executionBackend ?? parsed.runtimeMode) === "rpc" ? "rpc" : "sdk",
        fileEditor:
          parsed.fileEditor === "cursor" ||
          parsed.fileEditor === "zed" ||
          parsed.fileEditor === "webstorm" ||
          parsed.fileEditor === "system"
            ? parsed.fileEditor
            : "vscode",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Failed to read Pi Chamber settings", error);
    }
  })();
  return loaded;
};

export const getExecutionBackend = () => config.executionBackend;
export const getFileEditor = () => config.fileEditor;

const saveConfig = async () => {
  await mkdir(join(homedir(), ".pichamber"), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, "utf8");
  await rename(temporaryPath, configPath);
};

export const setExecutionBackend = async (executionBackend: PiExecutionBackend) => {
  config = { ...config, executionBackend };
  await saveConfig();
};

export const setFileEditor = async (fileEditor: FileEditor) => {
  config = { ...config, fileEditor };
  await saveConfig();
};
