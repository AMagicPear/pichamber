/**
 * Cross-platform filesystem path helpers.
 *
 * Node's `path.basename` / `path.dirname` require choosing the right
 * variant (posix vs win32) for the input, but the server and client see
 * absolute paths from whichever OS created them — a server on macOS may
 * receive `C:\Users\foo` from the client, and vice versa. We treat `/`
 * and `\` as separators everywhere so a Windows path splits the same way
 * a Unix one does, without forcing either side to normalise separators
 * (which would leak `\` back into the UI on Unix, etc.).
 */

const SLASH = 47; // "/"
const BACKSLASH = 92; // "\"

const isSeparator = (code: number) => code === SLASH || code === BACKSLASH;

const nextSeparatorIndex = (path: string, start: number) => {
  for (let i = start; i < path.length; i++) {
    if (isSeparator(path.charCodeAt(i))) return i;
  }
  return -1;
};

const rootLength = (path: string): number => {
  if (path.length === 0) return 0;
  if (
    path.length >= 2 &&
    isSeparator(path.charCodeAt(0)) &&
    isSeparator(path.charCodeAt(1))
  ) {
    const serverEnd = nextSeparatorIndex(path, 2);
    if (serverEnd < 0) return path.length;
    const shareEnd = nextSeparatorIndex(path, serverEnd + 1);
    return shareEnd < 0 ? path.length : shareEnd + 1;
  }
  if (isSeparator(path.charCodeAt(0))) return 1;
  if (path.length >= 3 && path[1] === ":" && isSeparator(path.charCodeAt(2))) return 3;
  return 0;
};

/** Trim cosmetic trailing separators without destroying `/` or `C:\`. */
export const pathTrimTrailing = (path: string): string => {
  let end = path.length;
  const root = rootLength(path);
  while (end > root) {
    const code = path.charCodeAt(end - 1);
    if (!isSeparator(code)) break;
    end -= 1;
  }
  return end === path.length ? path : path.slice(0, end);
};

const trimTrailing = pathTrimTrailing;

/** Index of the last separator in `path` (either `/` or `\`), or -1. The
 *  search range is computed after trimming trailing separators so a path
 *  like `/Users/foo/` finds the `/` between `Users` and `foo`. */
export const lastSeparatorIndex = (path: string): number => {
  const trimmed = trimTrailing(path);
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const code = trimmed.charCodeAt(i);
    if (isSeparator(code)) return i;
  }
  return -1;
};

/** Last segment of a path (the part after the final separator). Mirrors
 *  `path.basename`: trailing separators are cosmetic and ignored. */
export const pathBasename = (path: string): string => {
  const trimmed = trimTrailing(path);
  if (trimmed.length === 0) return path;
  if (trimmed.length === rootLength(trimmed)) return trimmed;
  const i = lastSeparatorIndex(trimmed);
  return i < 0 ? trimmed : trimmed.slice(i + 1);
};

/** Everything before the final separator, or "" if there isn't one.
 *  Mirrors `path.dirname`: trailing separators are cosmetic and ignored. */
export const pathDirname = (path: string): string => {
  const trimmed = trimTrailing(path);
  const root = rootLength(trimmed);
  if (trimmed.length <= root) return trimmed;
  const i = lastSeparatorIndex(trimmed);
  if (i < 0) return "";
  return trimmed.slice(0, Math.max(i, root));
};

/** UI-only prefix stripping for paths received from the same server. Security
 *  checks belong on the server and use `node:path.relative` plus `realpath`. */
export const stripParent = (parent: string, child: string): string | undefined => {
  const normalizedParent = trimTrailing(parent);
  if (child === normalizedParent) return "";
  if (!child.startsWith(normalizedParent)) return undefined;
  const root = rootLength(normalizedParent);
  if (normalizedParent.length === root) return child.slice(root);
  return isSeparator(child.charCodeAt(normalizedParent.length))
    ? child.slice(normalizedParent.length + 1)
    : undefined;
};
