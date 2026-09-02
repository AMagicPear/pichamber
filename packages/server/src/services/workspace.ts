/** Files, Git, and PTY use the active Pi session's cwd as their workspace.
 * Requests without a session fall back to the server user's home directory. */
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

/** Current workspace without an override (i.e. the user's home directory).
 *  Used when the caller doesn't yet know the session cwd. */
export const getWorkspace = (): string => homedir();

export class WorkspaceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Resolve the active workspace root from an optional override. The
 *  override is typically the current session's cwd. `"~"` and empty inputs
 *  fall back to the home directory, matching the legacy behaviour. */
export const resolveWorkspace = (override?: string | null): string => {
  const trimmed = override?.trim();
  if (!trimmed || trimmed === "~") return getWorkspace();
  return isAbsolute(trimmed) ? trimmed : resolve(getWorkspace(), trimmed);
};

export const canonicalWorkspace = async (path?: string | null) => realpath(resolveWorkspace(path));

/**
 * Collapse a workspace-rooted path to its display form. Used for tab
 * titles, tree entries, and anywhere we'd otherwise show a long absolute
 * path. Mirrors the terminal tab title so `~` means the same thing in
 * both surfaces.
 */
export const shortPath = (path: string, workspace?: string): string => {
  const ws = workspace ?? getWorkspace();
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
 * Resolve a user-supplied path against the workspace.
 *
 * - `~` and `~/foo` always expand against the user's home directory
 *   (`homedir()`), matching shell convention — this is true regardless of
 *   which session is active, so `~/notes.md` means the same file whether
 *   you're in /projects/foo or /projects/bar.
 * - Absolute paths pass through unchanged.
 * - Everything else is treated as relative to the workspace (the active
 *   session cwd, or `homedir()` if no session is selected).
 *
 * Returns the resolved absolute path. Callers that care about workspace
 * containment should layer their own check on top — by design this helper
 * does not enforce containment, so it stays useful for both the terminal
 * (which deliberately accepts any cwd) and the files panel.
 */
export const resolveInWorkspace = (input: string, workspace?: string): string => {
  const ws = workspace ?? getWorkspace();
  if (input === "~" || input.startsWith("~/")) return resolve(getWorkspace(), input.slice(2));
  return isAbsolute(input) ? input : resolve(ws, input);
};

/** Both arguments must be canonical paths from the current host. */
export const isWithinWorkspace = (path: string, workspace: string): boolean => {
  const rel = relative(workspace, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
};

export const canonicalPathInWorkspace = async (input: string, workspace: string) => {
  const path = await realpath(resolveInWorkspace(input, workspace));
  if (!isWithinWorkspace(path, workspace)) {
    throw new WorkspaceError("Path is outside of the active workspace");
  }
  return path;
};
