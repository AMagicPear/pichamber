/**
 * Git operations for the Git pane.
 *
 * Every command runs in the caller-supplied cwd (the session's workspace,
 * mirroring the files panel) — `git -C <cwd>` scopes paths, so they stay
 * workspace-relative and git itself handles containment.
 *
 * The client never has to parse porcelain output: the server turns
 * `git status` into a structured GitChange list, hands diffs back as
 * text, and parses branch/stash listings into typed records — keeping
 * status codes, quoting rules, and ref-format quirks server-side.
 */
import type {
  GitBranch,
  GitBranchList,
  GitChange,
  GitStash,
  GitStashList,
  GitStatus,
} from "@amagicpear/pichamber-shared";
import { getWorkspace } from "./workspace";
import { WorkspaceError } from "./workspace";

type GitResult = { stdout: string; stderr: string; code: number };

/** Normalise a client-supplied cwd ("~" means the default workspace). */
const resolveCwd = (cwd: string | undefined): string =>
  cwd && cwd !== "~" ? cwd : getWorkspace();

const runGit = async (cwd: string | undefined, args: string[]): Promise<GitResult> => {
  const proc = Bun.spawn(["git", "-C", resolveCwd(cwd), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout: stdout.trimEnd(), stderr: stderr.trim(), code };
};

/** Throw for non-repository / git-not-installed cases, so callers map it to 400. */
const assertOk = (result: GitResult) => {
  if (result.code !== 0) {
    throw new WorkspaceError(result.stderr || "git command failed", 400);
  }
};

const codeToStatus = (code: string): GitChange["status"] => {
  switch (code) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
};

/** Parse NUL-delimited porcelain output so paths are never quoted or escaped. */
export const parseStatus = (stdout: string): GitStatus => {
  const records = stdout.split("\0");
  let branch: string | null = null;
  const changes: GitChange[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith("## ")) {
      const head = record.slice(3).split("...")[0] ?? "";
      branch = head.startsWith("HEAD ")
        ? null
        : head.replace(/^No commits yet on /, "").split(" ")[0] || null;
      continue;
    }
    if (record.length < 4) continue;

    const [index, worktree] = [record[0], record[1]];
    const path = record.slice(3);
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") i += 1;

    if (index === "?" && worktree === "?") {
      changes.push({ path, status: "untracked", staged: false });
      continue;
    }

    const staged = index !== " ";
    changes.push({
      path,
      status: codeToStatus(staged ? index : worktree),
      staged,
    });
  }

  return { branch, changes };
};

/** Parse `git for-each-ref` output for `listBranches`. Format string
 *  produces `HEAD|name|upstream|track|committerdate:short|refname`, one
 *  record per line. We keep `refname` so we can tell local refs
 *  (`refs/heads/*`) apart from remote-tracking refs (`refs/remotes/*`)
 *  without guessing from the short name. Track codes from
 *  `%(upstream:track)`: "" (no upstream), "ahead N", "behind N",
 *  "ahead N, behind M" — kept as a raw string so the client can render. */
export const parseBranchList = (stdout: string): GitBranchList => {
  const branches: GitBranch[] = [];
  let current: string | null = null;

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [head, name = "", upstream = "", track = "", date = "", refname = ""] = line.split("|");
    if (!name || !refname) continue;
    const isCurrent = head === "*";
    if (isCurrent) current = name;
    branches.push({
      name,
      current: isCurrent,
      upstream: upstream || null,
      track,
      date,
      remote: refname.startsWith("refs/remotes/"),
    });
  }

  return { current, branches };
};

/** Parse `git stash list --format=...` output. We use a record separator
 *  of `@@` (literal) inside the format string so the on-the-wire line
 *  itself can't contain it: stash messages are user-authored and may
 *  contain newlines / pipes. */
export const parseStashList = (stdout: string): GitStashList => {
  const stashes: GitStash[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const sep = line.indexOf("@@");
    if (sep < 0) continue;
    const ref = line.slice(0, sep);
    const message = line.slice(sep + 2);
    const match = /^stash@\{(\d+)\}$/.exec(ref);
    if (!match) continue;
    stashes.push({
      index: Number(match[1]),
      ref,
      message,
    });
  }
  return { stashes };
};

export const getStatus = async (cwd?: string): Promise<GitStatus> => {
  const result = await runGit(cwd, ["status", "--porcelain=v1", "-z", "-b"]);
  assertOk(result);
  return parseStatus(result.stdout);
};

export const getDiff = async (cwd: string | undefined, path: string, staged: boolean): Promise<string> => {
  const args = ["diff", ...(staged ? ["--cached"] : []), "--", path];
  const result = await runGit(cwd, args);
  assertOk(result);
  return result.stdout;
};

export const stagePaths = async (cwd: string | undefined, paths?: string[]): Promise<void> => {
  const args = paths && paths.length > 0 ? ["add", "--", ...paths] : ["add", "-A"];
  const result = await runGit(cwd, args);
  assertOk(result);
};

export const unstagePaths = async (cwd: string | undefined, paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const result = await runGit(cwd, ["restore", "--staged", "--", ...paths]);
  assertOk(result);
};

/** Throw away changes for a list of paths. The decision tree:
 *  - untracked files: deleted via `rm` (git can't help — they're not in
 *    the index).
 *  - tracked files (modified/staged/added/deleted/renamed): reverted to
 *    HEAD via `git checkout HEAD --`, which clears both staged and
 *    worktree edits in one shot.
 *  The caller passes paths from a single `GitStatus` snapshot; we re-read
 *  status here to classify them, accepting one extra git call so the UI
 *  can fire a single "discard" intent regardless of change type. */
export const discardPaths = async (cwd: string | undefined, paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const status = await getStatus(cwd);
  const statusByPath = new Map(status.changes.map((c) => [c.path, c]));

  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const path of paths) {
    if (statusByPath.get(path)?.status === "untracked") untracked.push(path);
    else tracked.push(path);
  }

  if (tracked.length > 0) {
    const result = await runGit(cwd, ["checkout", "HEAD", "--", ...tracked]);
    assertOk(result);
  }
  if (untracked.length > 0) {
    const proc = Bun.spawn(["rm", "-f", "--", ...untracked], {
      cwd: resolveCwd(cwd),
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) {
      throw new WorkspaceError(stderr.trim() || "Failed to delete untracked files", 400);
    }
  }
};

export const commit = async (cwd: string | undefined, message: string): Promise<void> => {
  if (!message.trim()) {
    throw new WorkspaceError("Commit message is required", 400);
  }
  // `git commit -m` treats the arg as a single message regardless of
  // newlines; passing it as one argv element keeps multi-line messages safe.
  const result = await runGit(cwd, ["commit", "-m", message]);
  assertOk(result);
};

/** Initialise a repo in the workspace. We deliberately don't pass
 *  `--initial-branch`: the flag (>=2.28) is recent, and `git init` already
 *  honours the user's `init.defaultBranch` config. Naming the default is
 *  a project choice, not ours. */
export const init = async (cwd: string | undefined): Promise<void> => {
  const result = await runGit(cwd, ["init"]);
  assertOk(result);
};

/** List all branches. `git branch -a` includes both local and remote
 *  refs (the latter as `remotes/origin/foo`); we normalise the prefix
 *  in `parseBranchList`. */
export const listBranches = async (cwd: string | undefined): Promise<GitBranchList> => {
  const result = await runGit(cwd, [
    "for-each-ref",
    "--format=%(HEAD)|%(refname:short)|%(upstream:short)|%(upstream:track)|%(committerdate:short)|%(refname)",
    "refs/heads",
    "refs/remotes",
  ]);
  assertOk(result);
  return parseBranchList(result.stdout);
};

/** Switch to an existing branch. Use `git switch` (>=2.23) which refuses
 *  to clobber uncommitted changes with a clear error — matching the
 *  safer semantics we'd want anyway. Older gits error with a "unknown
 *  subcommand" message, which the UI surfaces verbatim. */
export const checkout = async (cwd: string | undefined, branch: string): Promise<void> => {
  if (!branch) throw new WorkspaceError("Branch name is required", 400);
  const result = await runGit(cwd, ["switch", branch]);
  assertOk(result);
};

export const push = async (cwd: string | undefined): Promise<void> => {
  const result = await runGit(cwd, ["push"]);
  assertOk(result);
};

export const pull = async (cwd: string | undefined): Promise<void> => {
  const result = await runGit(cwd, ["pull"]);
  assertOk(result);
};

/** Refresh the configured remote without touching the working tree. */
export const fetchRemotes = async (cwd: string | undefined): Promise<void> => {
  const result = await runGit(cwd, ["fetch", "--prune"]);
  assertOk(result);
};

/** Save the working tree + index as a stash entry. `-u` includes
 *  untracked so the common "stash everything" workflow is one click;
 *  callers can opt out by passing `includeUntracked: false`. */
export const stash = async (
  cwd: string | undefined,
  message?: string,
  includeUntracked = true,
): Promise<void> => {
  const args = ["stash", "push"];
  if (includeUntracked) args.push("-u");
  if (message?.trim()) args.push("-m", message.trim());
  const result = await runGit(cwd, args);
  assertOk(result);
};

export const stashPop = async (cwd: string | undefined): Promise<void> => {
  const result = await runGit(cwd, ["stash", "pop"]);
  assertOk(result);
};

/** Drop a stash by its ref. We use the full `stash@{n}` ref instead of
 *  relying on position so a concurrent stash action elsewhere can't
 *  shift indices out from under us. */
export const stashDrop = async (cwd: string | undefined, index: number): Promise<void> => {
  if (!Number.isInteger(index) || index < 0) {
    throw new WorkspaceError("Invalid stash index", 400);
  }
  const result = await runGit(cwd, ["stash", "drop", `stash@{${index}}`]);
  assertOk(result);
};

export const listStashes = async (cwd: string | undefined): Promise<GitStashList> => {
  const result = await runGit(cwd, ["stash", "list", "--format=%gd@@%s"]);
  assertOk(result);
  return parseStashList(result.stdout);
};
