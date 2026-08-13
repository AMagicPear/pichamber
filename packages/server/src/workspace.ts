/**
 * Active workspace — the directory pichamber treats as its root for both
 * the terminal default cwd and the files panel.
 *
 * The default workspace is the user's home directory, but per-request the
 * caller (files / git / pty) may pass the active session's cwd as an
 * override so the workspace tracks wherever the user actually opened the
 * session. On Windows the home directory often lives on a different drive
 * than the project, so this override is what makes `D:\dev\pichamber`
 * usable even when the home is `C:\Users\foo`. When workspace switching
 * lands, the override becomes the single source of truth; the home
 * fallback stays for callers that don't yet know the session cwd.
 */
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { isWithinPath, trimTrailingSeparators } from "@pichamber/shared";

const defaultWorkspace = (): string => homedir();

/** Current workspace without an override (i.e. the user's home directory).
 *  Used when the caller doesn't yet know the session cwd. */
export const getWorkspace = (): string => defaultWorkspace();

/** Resolve the active workspace root from an optional override. The
 *  override is typically the current session's cwd. `"~"` and empty inputs
 *  fall back to the home directory, matching the legacy behaviour. */
export const resolveWorkspace = (override?: string | null): string => {
  const trimmed = override?.trim();
  if (!trimmed || trimmed === "~") return defaultWorkspace();
  return isAbsolute(trimmed) ? trimmed : resolve(defaultWorkspace(), trimmed);
};

/**
 * Collapse a workspace-rooted path to its display form. Used for tab
 * titles, tree entries, and anywhere we'd otherwise show a long absolute
 * path. Mirrors the terminal tab title so `~` means the same thing in
 * both surfaces.
 */
export const shortPath = (path: string, workspace?: string): string => {
  const ws = workspace ?? defaultWorkspace();
  if (path === ws) return "~";
  // Use the separator that's actually in `path` so Windows displays stay
  // Windows-shaped (`~\projects`) and Unix displays stay Unix-shaped
  // (`~/projects`). Anything else passes through unchanged.
  if (path.length > ws.length && path.startsWith(ws)) {
    const sep = path[ws.length];
    if (sep === "/" || sep === "\\") return `~${path.slice(ws.length)}`;
  }
  return path;
};

/**
 * Resolve a user-supplied path against the workspace. Relative inputs are
 * joined onto the workspace root; absolute inputs pass through unchanged.
 *
 * Returns the resolved absolute path. Callers that care about workspace
 * containment should layer their own check on top — by design this helper
 * does not enforce containment, so it stays useful for both the terminal
 * (which deliberately accepts any cwd) and the files panel.
 */
export const resolveInWorkspace = (input: string, workspace?: string): string => {
  const ws = workspace ?? defaultWorkspace();
  return isAbsolute(input) ? input : resolve(ws, input);
};

/** True iff `path` is the workspace root or a descendant. */
export const isWithinWorkspace = (path: string, workspace?: string): boolean => {
  const ws = workspace ?? defaultWorkspace();
  return isWithinPath(ws, path);
};

/** Normalise a workspace root for keying / display: trim trailing
 *  separators (Windows roots rarely have them, Unix roots always do) so
 *  equality checks aren't tripped up by cosmetic differences. */
export const normaliseWorkspace = (workspace: string): string => trimTrailingSeparators(workspace);