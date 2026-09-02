/**
 * Wrap an `fd` invocation that mirrors the official pi TUI's
 * `CombinedAutocompleteProvider` file search (see
 * `@earendil-works/pi-tui/dist/autocomplete.js:walkDirectoryWithFd`). We only
 * consume `fd` if it's installed on the host — pichamber does not auto-
 * download it the way pi's interactive mode does (that 300-line release
 * downloader is internal to pi and not exported). On hosts without `fd`
 * the caller falls back to the directory walk.
 *
 * The flag set is intentionally identical to pi's:
 *   --base-directory <root>   --max-results 20 (ui cut, fd still returns ≤100)
 *   --type f --type d --follow --hidden
 *   --exclude .git, .git/*, .git/**
 *   when the query contains "/" we also pass --full-path so middle-of-tree
 *   matches surface
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { resolveInWorkspace } from "./workspace";

const MAX_FD_RESULTS = 100;
const TOP_N = 20;

export type FdEntry = { path: string; isDirectory: boolean };

/** Search PATH for an `fd` binary. Cached. `fdfind` is the Debian package's
 *  `fd` binary name; we accept it as a fallback the same way pi does.
 *  `undefined` means "haven't probed yet" — `null` means "probed and absent". */
let cachedFdPath: string | null | undefined;

const probeFdOnPath = (): string | null => {
  if (cachedFdPath !== undefined) return cachedFdPath;
  const candidates = ["fd", "fdfind"];
  const pathEnv = process.env.PATH ?? "";
  // Cache miss: actually probe PATH every cold call.
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of candidates) {
      const fullPath = join(dir, name);
      if (existsSync(fullPath)) {
        cachedFdPath = fullPath;
        return fullPath;
      }
    }
  }
  cachedFdPath = null;
  return null;
};

/** True iff an `fd` binary exists somewhere on PATH. */
export const isFdAvailable = (): boolean => probeFdOnPath() !== null;

const toRegex = (segment: string): string => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mirror `buildFdPathQuery`: if the user query is a single segment we hand it
 *  to fd as-is; multi-segment queries get a regex with [\\/] between
 *  segments (so `src/comp` matches `src/components/Foo.tsx`). Trailing `/`
 *  forces fd to keep listing through the directory instead of stopping on it. */
const buildQuery = (raw: string): string | null => {
  const normalized = raw.replace(/\\/g, "/");
  if (!normalized.includes("/")) return normalized;
  const hasTrailingSeparator = normalized.endsWith("/");
  const trimmed = normalized.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return normalized;
  const segments = trimmed
    .split("/")
    .filter(Boolean)
    .map((segment) => toRegex(segment));
  if (segments.length === 0) return normalized;
  return segments.join("[\\\\/]") + (hasTrailingSeparator ? "[\\\\/]" : "");
};

const runFd = (
  fdPath: string,
  query: string,
  baseDir: string,
  signal: AbortSignal,
): Promise<FdEntry[]> =>
  new Promise((onResult) => {
    const args = [
      "--base-directory",
      baseDir,
      "--max-results",
      String(MAX_FD_RESULTS),
      "--type",
      "f",
      "--type",
      "d",
      "--follow",
      "--hidden",
      "--exclude",
      ".git",
      "--exclude",
      ".git/*",
      "--exclude",
      ".git/**",
    ];
    const regexQuery = buildQuery(query);
    // Multi-segment queries need --full-path so a mid-tree match like
    // `src/comp` can find `src/components/Foo.tsx`. Empty / undefined
    // queries pass through as bare argv (fd lists everything).
    if (regexQuery && regexQuery.includes("/")) args.push("--full-path");
    if (regexQuery) args.push(regexQuery);

    const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let finished = false;
    const finish = (entries: FdEntry[]) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", onAbort);
      onResult(entries);
    };
    const onAbort = () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => finish([]));
    child.on("close", () => {
      if (signal.aborted) {
        finish([]);
        return;
      }
      if (!stdout) {
        finish([]);
        return;
      }
      const entries: FdEntry[] = [];
      for (const line of stdout.trim().split("\n")) {
        if (!line) continue;
        const hasTrailingSeparator = line.endsWith("/");
        const display = hasTrailingSeparator ? line.slice(0, -1) : line;
        if (display === ".git" || display.startsWith(".git/") || display.includes("/.git/"))
          continue;
        // fd prints paths relative to --base-directory. Resolve to absolute
        // so the caller can `relative()` against the workspace root the
        // same way it does for the BFS fallback.
        const absolutePath = resolveInWorkspace(display, baseDir);
        entries.push({ path: absolutePath, isDirectory: hasTrailingSeparator });
      }
      finish(entries);
    });
  });

/** Score a search hit the same way pi's `scoreEntry` does: exact filename
 *  match wins, then filename starts-with, then filename includes, then path
 *  includes. Directories get a small bonus so they float to the top of
 *  otherwise-tied hits. The BFS fallback in `fs.ts` sorts by the same
 *  function so fd-installed and fd-missing hosts rank identically. */
export const scoreEntry = (filePath: string, query: string, isDirectory: boolean): number => {
  const fileName = basename(filePath);
  const lowerFile = fileName.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return 1;
  let score = 0;
  if (lowerFile === lowerQuery) score = 100;
  else if (lowerFile.startsWith(lowerQuery)) score = 80;
  else if (lowerFile.includes(lowerQuery)) score = 50;
  else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;
  if (isDirectory && score > 0) score += 10;
  return score;
};

/** Top-level fd-driven search. Caller passes an `AbortSignal` (the WS route
 *  closes the signal on disconnect so we stop wasting CPU mid-search). */
export const fdSearch = async (
  query: string,
  baseDir: string,
  signal: AbortSignal,
): Promise<FdEntry[] | "unavailable"> => {
  const fdPath = probeFdOnPath();
  if (!fdPath) return "unavailable";
  const entries = await runFd(fdPath, query, baseDir, signal);
  if (!query) return entries.slice(0, TOP_N);
  const scored = entries
    .map((entry) => ({ ...entry, score: scoreEntry(entry.path, query, entry.isDirectory) }))
    .filter((entry) => entry.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, TOP_N);
};
