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

export type ProjectBrowseResult = {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
};
