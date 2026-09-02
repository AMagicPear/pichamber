/**
 * 文件浏览器 / 项目浏览 的 wire 类型（pichamber 自有功能）。
 */

/** One entry in GET /api/fs/list. */
export type DirEntry = {
  name: string;
  path: string;
  /** Path relative to the active workspace root, or "" if outside. */
  relativePath: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
};

/** Response body for GET /api/fs/list. */
export type ListResult = {
  path: string;
  /** Display form of `path` (`~` for the workspace root). */
  displayPath: string;
  entries: DirEntry[];
};

/** Response body for GET /api/fs/search. */
export type SearchResult = {
  entries: DirEntry[];
};

/** Response body for GET /api/fs/open. */
export type OpenFileResult = {
  /** Path that was opened with the OS default app (resolved, not canonical). */
  path: string;
};

export type ProjectBrowseResult = {
  /** Canonical path actually being browsed. When the caller asked for a
   *  path that doesn't exist (e.g. an orphan session's cwd), this falls
   *  back to the nearest existing ancestor so the UI can offer a usable
   *  starting point instead of failing outright. */
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
  /** The path the caller originally asked to browse, or null when it was
   *  resolved directly. A non-null value means `path` is an ancestor fallback. */
  requestedPath: string | null;
};
