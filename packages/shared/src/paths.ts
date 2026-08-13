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

/** Trim trailing separators from `path`. Returns the original if there
 *  are none. Mirrors how `path.basename` / `path.dirname` treat trailing
 *  slashes as cosmetic. */
const trimTrailing = (path: string): string => {
  let end = path.length;
  while (end > 0) {
    const code = path.charCodeAt(end - 1);
    if (code !== SLASH && code !== BACKSLASH) break;
    end -= 1;
  }
  return end === path.length ? path : path.slice(0, end);
};

/** Index of the last separator in `path` (either `/` or `\`), or -1. The
 *  search range is computed after trimming trailing separators so a path
 *  like `/Users/foo/` finds the `/` between `Users` and `foo`. */
export const lastSeparatorIndex = (path: string): number => {
  const trimmed = trimTrailing(path);
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const code = trimmed.charCodeAt(i);
    if (code === SLASH || code === BACKSLASH) return i;
  }
  return -1;
};

/** Last segment of a path (the part after the final separator). Mirrors
 *  `path.basename`: trailing separators are cosmetic and ignored. */
export const pathBasename = (path: string): string => {
  const trimmed = trimTrailing(path);
  if (trimmed.length === 0) return path;
  const i = lastSeparatorIndex(trimmed);
  return i < 0 ? trimmed : trimmed.slice(i + 1);
};

/** Everything before the final separator, or "" if there isn't one.
 *  Mirrors `path.dirname`: trailing separators are cosmetic and ignored. */
export const pathDirname = (path: string): string => {
  const trimmed = trimTrailing(path);
  if (trimmed.length === 0) return "";
  const i = lastSeparatorIndex(trimmed);
  return i < 0 ? "" : trimmed.slice(0, i);
};

/** True iff `child` equals `parent` or lives underneath it. */
export const isWithinPath = (parent: string, child: string): boolean => {
  if (child === parent) return true;
  // The parent/child boundary must be a real separator; without this,
  // `/foo/barbaz` would erroneously match `/foo/bar`.
  const len = parent.length;
  if (child.length > len) {
    if (child.startsWith(parent) && (child.charCodeAt(len) === SLASH || child.charCodeAt(len) === BACKSLASH)) {
      return true;
    }
  }
  return false;
};

/** Strip `parent` from the front of `child` if `child` is rooted there.
 *  Returns "" when `child === parent`, the bare remainder otherwise. */
export const stripParent = (parent: string, child: string): string | undefined => {
  if (child === parent) return "";
  const len = parent.length;
  if (child.length > len && child.startsWith(parent)) {
    const sep = child.charCodeAt(len);
    if (sep === SLASH || sep === BACKSLASH) return child.slice(len + 1);
  }
  return undefined;
};

/** Strip any trailing separator (`/` or `\`). Returns "" only for empty input. */
export const trimTrailingSeparators = (path: string): string =>
  path.replace(/[\\/]+$/, "");