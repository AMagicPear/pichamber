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
import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { FileEditor } from "../settings/app-config";
import { basename, relative, resolve } from "node:path";
import type { DirEntry, ListResult, OpenFileResult } from "@amagicpear/pichamber-shared";

import { fdSearch, isFdAvailable, scoreEntry } from "./fd-search";
import { canonicalPathInWorkspace, canonicalWorkspace, getWorkspace, resolveInWorkspace, shortPath } from "./workspace";

/**
 * Reject any path that escapes the workspace, including symlink targets.
 */
const ensureWithinWorkspace = async (input: string, workspace: string): Promise<string> => {
  return canonicalPathInWorkspace(input, workspace);
};

const toRelative = (path: string, workspace: string): string => relative(workspace, path);

export const listDirectory = async (
  input: string | undefined,
  workspacePath?: string | null,
): Promise<ListResult> => {
  const workspace = await canonicalWorkspace(workspacePath);
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

/** Recursively search the workspace for entries whose name or path matches
 *  the query (BFS with a depth cap, skipping large noisy dirs). Used as a
 *  fallback when `fd` isn't installed; ranks identically to the fd path
 *  via the shared `scoreEntry`. */
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

/** Fallback search used when `fd` is not installed on the host. Walks the
 *  workspace BFS-style with a depth cap; ranks matches with the same
 *  `scoreEntry` fd uses (so fd-installed and fd-missing hosts return hits
 *  in the same order). */
const bfsFallbackSearch = async (
  q: string,
  workspace: string,
  limit: number,
): Promise<DirEntry[]> => {
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
            if (scoreEntry(entryPath, q, true) > 0) matches.push(toEntry(dirent.name, entryPath, true, workspace));
          } else if (dirent.isFile() && scoreEntry(entryPath, q, false) > 0) {
            matches.push(toEntry(dirent.name, entryPath, false, workspace));
          }
        }
      }),
    );
    frontier = next;
  }
  return matches
    .map((entry) => ({ entry, score: scoreEntry(entry.path, q, entry.isDirectory) }))
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.entry)
    .slice(0, limit);
};

export const searchFiles = async (
  query: string,
  limit = 60,
  workspacePath?: string | null,
): Promise<DirEntry[]> => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const workspace = await canonicalWorkspace(workspacePath);
  // AbortSignal kept around the whole call so the WS route can drop us on
  // disconnect. fd's child process gets SIGKILL via the handler in fd-search.
  const ac = new AbortController();
  if (isFdAvailable()) {
    const result = await fdSearch(trimmed, workspace, ac.signal);
    if (result !== "unavailable") {
      return result.map((entry) => toEntry(basename(entry.path), entry.path, entry.isDirectory, workspace));
    }
  }
  // `scoreEntry` lowercases internally; hand it the raw query and let it
  // handle case folding so fd/BFS paths agree on what counts as a match.
  return bfsFallbackSearch(trimmed, workspace, limit);
};

/** The OS command that opens a path in the default app / file manager. */
const openCommand = (editor: FileEditor, target: string): string[] => {
  if (editor === "vscode") return ["code", "--goto", target];
  if (editor === "cursor") return ["cursor", "--goto", target];
  if (editor === "zed") return ["zed", target];
  if (editor === "webstorm") return ["webstorm", "--line", target];
  if (process.platform === "darwin") return ["open"];
  if (process.platform === "win32") return ["cmd", "/c", "start", ""]; // empty title arg
  return ["xdg-open"];
};

/**
 * Open a path with the OS default application (default editor / Finder).
 *
 * Unlike the rest of this module, no existence or containment check —
 * the terminal-style contract: open whatever path the caller hands us.
 * Relative paths resolve against the workspace root, `~/…` expands to the
 * home directory, absolute paths pass through untouched. Fire-and-forget:
 * we resolve once the child spawns and unref it so the GUI app outlives
 * the server.
 */
export const openFile = async (
  input: string,
  workspacePath?: string | null,
  editor: FileEditor = "vscode",
): Promise<OpenFileResult> => {
  const workspace = await canonicalWorkspace(workspacePath);
  const line = /^(.*[^:\d]):(\d+)$/.exec(input);
  const fileInput = line && editor !== "system" ? line[1] : input;
  const target =
    fileInput === "~" || fileInput.startsWith("~/")
      ? resolve(getWorkspace(), fileInput.slice(2))
      : resolveInWorkspace(fileInput, workspace);
  await new Promise<void>((resolve, reject) => {
    const editorTarget = line && editor !== "system" ? `${target}:${line[2]}` : target;
    const [cmd, ...args] = openCommand(editor, editorTarget);
    const child = spawn(cmd, editor === "system" ? [...args, editorTarget] : args, { stdio: "ignore", detached: true, windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { path: target };
};
