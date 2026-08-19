/**
 * Server-side persistent settings.
 *
 * Lives at $PICHAMBER_SETTINGS_DIR/server.json (default
 * $XDG_CONFIG_HOME/pichamber/server.json). The current pichamber version
 * only uses it for the optional external `pi` executable path: when set,
 * new sessions are launched by spawning that binary in RPC mode instead
 * of using the bundled SDK. Files, Git, and PTY remain server services
 * and never depend on the runtime choice.
 *
 * Reads are eager and cached in-process. The API store serializes browser
 * updates before calling `save()`, so every write is a complete snapshot and
 * a setting change is immediately observable by newly opened sessions.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

export type ServerSettings = {
  /** Toggle the external `pi --mode rpc` runtime for newly opened sessions. */
  useExternalPi: boolean;
  /** Path to the `pi` executable (absolute or `$PATH`-resolvable). */
  externalPiPath: string;
};

const DEFAULTS: ServerSettings = {
  useExternalPi: false,
  externalPiPath: "",
};

const settingsDir = (): string => {
  const override = process.env.PICHAMBER_SETTINGS_DIR;
  if (override) return resolve(override);
  // Mirror XDG: $XDG_CONFIG_HOME/pichamber when set, else ~/.config/home.
  const xdg = process.env.XDG_CONFIG_HOME;
  return resolve(xdg && xdg.trim() ? xdg : join(homedir(), ".config"), "pichamber");
};

const settingsPath = (): string => join(settingsDir(), "server.json");

let cache: ServerSettings | null = null;

const coerce = (raw: Partial<ServerSettings> | null | undefined): ServerSettings => ({
  useExternalPi: typeof raw?.useExternalPi === "boolean" ? raw.useExternalPi : DEFAULTS.useExternalPi,
  externalPiPath:
    typeof raw?.externalPiPath === "string" ? raw.externalPiPath : DEFAULTS.externalPiPath,
});

const loadFromDisk = (): ServerSettings => {
  const path = settingsPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ServerSettings>;
    return coerce(raw);
  } catch {
    return { ...DEFAULTS };
  }
};

export const getServerSettings = (): ServerSettings => cache ?? (cache = loadFromDisk());

/**
 * Persist settings to disk. The path is validated enough to surface
 * typos early: `useExternalPi` only takes effect when `externalPiPath`
 * points at something the server can resolve, but we don't refuse empty
 * strings so a user can clear the path while toggling the option off.
 */
export const saveServerSettings = (next: Partial<ServerSettings>): ServerSettings => {
  const merged: ServerSettings = {
    useExternalPi:
      typeof next.useExternalPi === "boolean" ? next.useExternalPi : getServerSettings().useExternalPi,
    externalPiPath:
      typeof next.externalPiPath === "string" ? next.externalPiPath : getServerSettings().externalPiPath,
  };
  cache = merged;
  const path = settingsPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(merged, null, 2));
  renameSync(temporaryPath, path);
  return merged;
};

/** Search `$PATH` for a bare executable name. Returns the absolute
 *  path to the first match, or `null` if nothing on PATH exposes it.
 *  Mirrors what `which` does without shelling out. */
const resolveOnPath = (name: string): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

/**
 * Resolve the configured external `pi` path. Three cases:
 *
 *  1. Empty input → resolve `pi` from `$PATH` so the user can leave the
 *     field blank and rely on whatever `pi` is on their PATH.
 *  2. Absolute path → use it directly if it exists, otherwise `null`.
 *  3. Bare name or relative path → search `$PATH` (relative paths with
 *     a separator resolve against the cwd first, then PATH).
 *
 * Returns `null` when the option is off or the executable is missing,
 * so the runtime factory can choose between SDK and RPC backends and
 * surface a clear "not found" error at session-creation time. */
export const resolveExternalPi = (): string | null => {
  const settings = getServerSettings();
  if (!settings.useExternalPi) return null;
  const raw = settings.externalPiPath.trim() || "pi";
  if (isAbsolute(raw)) return existsSync(raw) ? raw : null;
  if (existsSync(raw)) return resolve(raw); // relative path with separator
  return resolveOnPath(raw);
};

/** Snapshot returned to the Settings UI so the user can see exactly
 *  which executable the server will spawn (and whether it was found).
 *  The Settings UI mirrors the resolved path back so a user who leaves
 *  the field blank sees `/Users/foo/.bun/bin/pi` rather than a bare
 *  `pi` that only the shell would understand. */
export const describeExternalPi = (): {
  configured: boolean;
  rawPath: string;
  resolved: string | null;
} => {
  const settings = getServerSettings();
  const rawPath = settings.externalPiPath.trim();
  return {
    configured: settings.useExternalPi,
    rawPath,
    resolved: settings.useExternalPi ? resolveExternalPi() : null,
  };
};

/** Test helper: drop the in-memory cache so the next read re-reads the
 *  file. Production code never needs this. */
export const resetServerSettingsForTests = (): void => {
  cache = null;
};
