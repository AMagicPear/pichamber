/**
 * Filesystem operations for the files panel.
 *
 * Everything resolves through the active workspace. Paths outside the
 * workspace are rejected with a clear error — outside-workspace grants
 * are intentionally out of scope until workspace switching lands. The
 * terminal still accepts any cwd (it has its own containment rules);
 * this module is just for the files panel.
 *
 * Conventions:
 * - `path` is always absolute (server canonicalises via `realpath`).
 * - `relativePath` is the entry's path relative to the workspace root,
 *   used for display. Empty for entries outside the workspace.
 * - Directories-first sort, then case-insensitive name.
 */
import { readdir, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { getWorkspace, isWithinWorkspace, resolveInWorkspace, shortPath } from "./workspace";

export { shortPath };

export interface DirEntry {
  name: string;
  path: string;
  /** Path relative to the workspace root, or empty if outside. */
  relativePath: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface ListResult {
  path: string;
  /** Display form of `path` (`~` for the workspace root). */
  displayPath: string;
  entries: DirEntry[];
}

export class WorkspaceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Reject any path that escapes the workspace, including symlink targets.
 */
async function ensureWithinWorkspace(input: string): Promise<string> {
  const resolved = resolveInWorkspace(input);
  const checkedPath = await realpath(resolved);
  if (!isWithinWorkspace(checkedPath)) {
    throw new WorkspaceError("Path is outside of the active workspace");
  }
  return checkedPath;
}

function toRelative(path: string): string {
  const workspace = getWorkspace();
  if (path === workspace) return "";
  if (path.startsWith(`${workspace}/`)) return path.slice(workspace.length + 1);
  return "";
}

export async function listDirectory(input?: string): Promise<ListResult> {
  const target = input === undefined || input === "" ? getWorkspace() : await ensureWithinWorkspace(input);
  const dirents = await readdir(target, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<DirEntry> => {
      const entryPath = resolve(target, dirent.name);
      let isDirectory = dirent.isDirectory();
      let isSymbolicLink = dirent.isSymbolicLink();
      if (!isDirectory && isSymbolicLink) {
        try {
          isDirectory = (await stat(entryPath)).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      return {
        name: dirent.name,
        path: entryPath,
        relativePath: toRelative(entryPath),
        isDirectory,
        isFile: dirent.isFile(),
        isSymbolicLink,
      };
    }),
  );
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return { path: target, displayPath: shortPath(target), entries };
}

