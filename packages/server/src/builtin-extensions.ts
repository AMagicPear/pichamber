/**
 * pichamber 内置扩展。
 *
 * 内置扩展是 pichamber 随附的真实 Pi 扩展（见 `packages/builtin-extensions/`）。
 * 它们在设置页里列出来，由用户手动「一键配置」：点击后 pichamber 把扩展文件
 * 同步到用户的 `~/.pi/agent/extensions/`，然后重载当前会话的扩展，让配置立即
 * 生效。不点击则什么都不做。
 *
 * 装到 `~/.pi/agent/extensions/` 意味着：在 pichamber 里可用，在任意地方直接
 * 运行 `pi` 时也同样可用（Pi 自动发现该目录）——不会和原生的 Pi 割裂。
 *
 * 每个内置扩展有一个 id（如 `ark-agent-plan`）和源目录。安装时把 `index.ts`
 * 与 `package.json` 复制为 `~/.pi/agent/extensions/pichamber-<id>/`；扩展
 * 自包含、无第三方运行时依赖，所以这两个文件就够。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { PiBuiltinExtension } from "@pichamber/shared";

export type BuiltinExtensionDef = {
  id: string;
  name: string;
  description: string;
  /** Absolute path to the extension source directory in this repo. */
  sourceDir: string;
};

/** Source root for bundled extensions: `packages/server/src/../../builtin-extensions`. */
const BUILTIN_EXTENSIONS_ROOT = join(import.meta.dir, "..", "..", "builtin-extensions");

/** Every built-in extension pichamber ships. Add new ones here to have them
 *  listed and configured by the same machinery. */
export const builtinExtensions: BuiltinExtensionDef[] = [
  {
    id: "ark-agent-plan",
    name: "Ark Agent Plan",
    description:
      "Registers Volcengine Ark Agent Plan as a provider. Model list is fetched dynamically from the control plane (ListArkAgentPlanModel); quota shows in Usage & balance.",
    sourceDir: join(BUILTIN_EXTENSIONS_ROOT, "ark-agent-plan"),
  },
];

/** Installed folder name for a built-in under `~/.pi/agent/extensions/`. */
const installedDirName = (id: string) => `pichamber-${id}`;

/** Files copied from a built-in source into the user's extensions folder. */
const SOURCE_FILES = ["index.ts", "package.json"] as const;

const extensionsRoot = () => join(getAgentDir(), "extensions");

const readVersion = (dir: string): string => {
  const packageJson = join(dir, "package.json");
  if (!existsSync(packageJson)) return "";
  try {
    const raw = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: string };
    return typeof raw.version === "string" ? raw.version : "";
  } catch {
    return "";
  }
};

/** Installed path for a built-in extension id (may not exist). */
export const installedExtensionPath = (id: string): string =>
  join(extensionsRoot(), installedDirName(id));

/** Whether a built-in extension's folder currently exists in the agent dir. */
const isInstalled = (id: string): boolean => existsSync(installedExtensionPath(id));

/** Copy a built-in's source files into the user's extensions folder.
 *  Idempotent: replaces a stale install when the bundled version differs. */
export const installBuiltinExtension = (def: BuiltinExtensionDef): void => {
  const target = installedExtensionPath(def.id);
  const bundledVersion = readVersion(def.sourceDir);
  if (isInstalled(def.id) && readVersion(target) === bundledVersion) return;

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of SOURCE_FILES) {
    const from = join(def.sourceDir, file);
    if (existsSync(from)) cpSync(from, join(target, file));
  }
};

/** Remove a built-in's folder from the user's extensions folder. */
export const removeBuiltinExtension = (def: BuiltinExtensionDef): void => {
  rmSync(installedExtensionPath(def.id), { recursive: true, force: true });
};

/** Overview for the Settings UI: every built-in with its installed state. */
export const listBuiltinExtensions = (): PiBuiltinExtension[] =>
  builtinExtensions.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    version: readVersion(def.sourceDir),
    installed: isInstalled(def.id),
  }));

/** Look up a built-in definition by id, throwing on unknown ids. */
export const getBuiltinExtension = (id: string): BuiltinExtensionDef => {
  const def = builtinExtensions.find((entry) => entry.id === id);
  if (!def) throw new Error(`Unknown built-in extension: ${id}`);
  return def;
};
