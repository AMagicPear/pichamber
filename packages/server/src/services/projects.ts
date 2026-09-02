import { readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import type { ProjectBrowseResult } from "@amagicpear/pichamber-shared";
import { canonicalWorkspace, getWorkspace } from "./workspace";

/** Walk up `target` until `realpath` resolves, then return that ancestor.
 *  Returns `null` if even the root of the path doesn't exist — the caller
 *  can then fall back to a known-good root (home) instead of throwing. */
const climbToExistingAncestor = async (target: string): Promise<string | null> => {
  let current = target;
  const root = parse(current).root;
  // Bound the climb so a pathological input (e.g. a relative path that
  // canonicalWorkspace never resolved) can't loop forever.
  for (let depth = 0; depth < 4096; depth += 1) {
    try {
      return await realpath(current);
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "ENOENT") throw error;
      if (current === root) return null;
      const next = dirname(current);
      if (next === current) return null;
      current = next;
    }
  }
  return null;
};

const readDirectory = async (
  path: string,
  requestedPath: string | null,
): Promise<ProjectBrowseResult> => {
  const entries = await readdir(path, { withFileTypes: true });
  const directories = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map(async (entry) => {
        const candidate = join(path, entry.name);
        try {
          return { name: entry.name, path: await realpath(candidate) };
        } catch {
          return null;
        }
      }),
  );
  const root = parse(path).root;
  return {
    path,
    parent: path === root ? null : dirname(path),
      entries: directories
      .filter((entry): entry is { name: string; path: string } => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name)),
    requestedPath,
  };
};

export const browseProjectDirectories = async (input?: string | null): Promise<ProjectBrowseResult> => {
  // Resolve "~", relative paths, and trigger realpath. When the caller asks
  // for a non-existent path (e.g. an orphan session's cwd), `canonicalWorkspace`
  // throws ENOENT — fall back to the nearest existing ancestor so the picker
  // can still surface a usable starting directory instead of an empty screen.
  let resolved: string;
  let requestedPath: string | null = null;
  try {
    resolved = await canonicalWorkspace(input || getWorkspace());
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "ENOENT") throw error;
    const trimmed = input?.trim();
    const absolute = trimmed ? (isAbsolute(trimmed) ? trimmed : resolve(getWorkspace(), trimmed)) : getWorkspace();
    const ancestor = await climbToExistingAncestor(absolute);
    const fallback = ancestor ?? (await climbToExistingAncestor(getWorkspace())) ?? getWorkspace();
    requestedPath = trimmed || getWorkspace();
    resolved = fallback;
  }
  return readDirectory(resolved, requestedPath);
};
