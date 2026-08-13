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
import type { DirEntry, ListResult } from "@pichamber/shared";
import { stripParent } from "@pichamber/shared";

import { isWithinWorkspace, resolveInWorkspace, resolveWorkspace, shortPath } from "./workspace";

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
const ensureWithinWorkspace = async (input: string, workspace: string): Promise<string> => {
  const resolved = resolveInWorkspace(input, workspace);
  const checkedPath = await realpath(resolved);
  if (!isWithinWorkspace(checkedPath, workspace)) {
    throw new WorkspaceError("Path is outside of the active workspace");
  }
  return checkedPath;
};

const toRelative = (path: string, workspace: string): string => {
  const relative = stripParent(workspace, path);
  return relative ?? "";
};

export const listDirectory = async (
  input: string | undefined,
  workspaceOverride?: string | null,
): Promise<ListResult> => {
  const workspace = resolveWorkspace(workspaceOverride);
  const target =
    input === undefined || input === "" ? workspace : await ensureWithinWorkspace(input, workspace);
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
        relativePath: toRelative(entryPath, workspace),
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
  return { path: target, displayPath: shortPath(target, workspace), entries };
};

/** 递归搜索 workspace 内名字匹配的文件/目录（BFS，限深度、跳过大目录）。
 *  给 @ 文件选择面板的搜索框用。 */
const SKIP_SEARCH_DIRS = new Set([
  "node_modules",
  "Library",
  ".git",
  ".Trash",
  ".cache",
  ".bun",
  ".local",
]);
const MAX_SEARCH_DEPTH = 4;

const toEntry = (name: string, path: string, isDirectory: boolean, workspace: string): DirEntry => ({
  name,
  path,
  relativePath: toRelative(path, workspace),
  isDirectory,
  isFile: !isDirectory,
  isSymbolicLink: false,
});

export const searchFiles = async (
  query: string,
  limit = 60,
  workspaceOverride?: string | null,
): Promise<DirEntry[]> => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const workspace = resolveWorkspace(workspaceOverride);
  const matches: DirEntry[] = [];
  let frontier: string[] = [workspace];
  for (let depth = 0; frontier.length > 0 && depth <= MAX_SEARCH_DEPTH && matches.length < limit; depth++) {
    const next: string[] = [];
    await Promise.all(
      frontier.map(async (dir) => {
        if (matches.length >= limit) return;
        let dirents;
        try {
          dirents = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const dirent of dirents) {
          if (matches.length >= limit) return;
          if (dirent.isSymbolicLink()) continue; // 防环
          const entryPath = resolve(dir, dirent.name);
          if (dirent.isDirectory()) {
            if (dirent.name.startsWith(".") || SKIP_SEARCH_DIRS.has(dirent.name)) continue;
            next.push(entryPath);
            if (dirent.name.toLowerCase().includes(q)) matches.push(toEntry(dirent.name, entryPath, true, workspace));
          } else if (dirent.isFile() && dirent.name.toLowerCase().includes(q)) {
            matches.push(toEntry(dirent.name, entryPath, false, workspace));
          }
        }
      }),
    );
    frontier = next;
  }
  // 前缀命中优先，然后目录优先，再按名字。
  return matches
    .sort((a, b) => {
      const aPrefix = a.name.toLowerCase().startsWith(q) ? 1 : 0;
      const bPrefix = b.name.toLowerCase().startsWith(q) ? 1 : 0;
      if (aPrefix !== bPrefix) return bPrefix - aPrefix;
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .slice(0, limit);
};