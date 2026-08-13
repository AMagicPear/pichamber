import { readdir, realpath } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import type { ProjectBrowseResult } from "@pichamber/shared";
import { canonicalWorkspace, getWorkspace } from "./workspace";

export const browseProjectDirectories = async (input?: string | null): Promise<ProjectBrowseResult> => {
  const path = await canonicalWorkspace(input || getWorkspace());
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
  };
};
