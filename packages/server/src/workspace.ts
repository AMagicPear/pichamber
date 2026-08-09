/**
 * Active workspace — the directory pichamber treats as its root for both
 * the terminal default cwd and the files panel.
 *
 * Today this is hard-wired to the user's home directory. When workspace
 * switching is implemented, `getWorkspace()` is the single place that
 * resolves the active workspace; both `pty.ts` and `fs.ts` read from here
 * so they stay aligned automatically.
 */
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/** Return the absolute path of the active workspace root. */
export const getWorkspace = (): string => homedir();

/**
 * Collapse a workspace-rooted path to its display form. Used for tab
 * titles, tree entries, and anywhere we'd otherwise show a long absolute
 * path. Mirrors the terminal tab title so `~` means the same thing in
 * both surfaces.
 */
export const shortPath = (path: string): string => {
  const workspace = getWorkspace();
  if (path === workspace) return "~";
  if (path.startsWith(`${workspace}/`)) return `~${path.slice(workspace.length)}`;
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
export const resolveInWorkspace = (input: string): string => {
  return isAbsolute(input) ? input : resolve(getWorkspace(), input);
};

/** True iff `path` is the workspace root or a descendant. */
export const isWithinWorkspace = (path: string): boolean => {
  const workspace = getWorkspace();
  if (path === workspace) return true;
  return path.startsWith(`${workspace}/`);
};
