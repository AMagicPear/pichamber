/**
 * Git 面板的 wire 类型（pichamber 自有功能，与 pi 会话无关）。
 */

/** One changed file from `git status --porcelain`. */
export type GitChange = {
  /** Workspace-relative path (renames carry the destination). */
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  /** True when the change is staged (present in the index). */
  staged: boolean;
};

/** Response body for GET /api/git/status. */
export type GitStatus = {
  /** Current branch name, or null on a detached HEAD. */
  branch: string | null;
  changes: GitChange[];
};

/** Response body for GET /api/git/diff. */
export type GitDiffResult = {
  /** Unified diff text; empty for files git can't diff (untracked). */
  diff: string;
};

/** Request body for POST /api/git/stage and /api/git/unstage. */
export type GitStageRequest = {
  sessionId?: string;
  /** Paths to stage/unstage. Omit for stage to add everything. */
  paths?: string[];
};

/** Request body for POST /api/git/commit. */
export type GitCommitRequest = {
  sessionId?: string;
  message: string;
};

/** One branch entry from `git for-each-ref`. */
export type GitBranch = {
  /** Short branch name (e.g. `main`, `origin/main`). */
  name: string;
  /** Whether this is the currently checked-out branch. Exactly one entry
   *  in the list — or none on detached HEAD — has `current: true`. */
  current: boolean;
  /** Upstream short name (e.g. `origin/main`), or `null` when no
   *  upstream is configured. */
  upstream: string | null;
  /** Raw `git for-each-ref` upstream track string: "" (no upstream),
   *  "ahead N", "behind N", "ahead N, behind M". Kept verbatim so the
   *  client renders the same display git would. */
  track: string;
  /** Short committer date (`YYYY-MM-DD`), last commit that touched the
   *  branch. Empty string for unborn branches. */
  date: string;
  /** True when the ref came from `refs/remotes/*` — a remote-tracking
   *  ref, not a local branch. */
  remote: boolean;
};

/** Response body for GET /api/git/branches. */
export type GitBranchList = {
  /** Name of the active branch (matches `GitBranch.current === true`),
   *  or `null` on detached HEAD. */
  current: string | null;
  branches: GitBranch[];
};

/** One entry from `git stash list`. */
export type GitStash = {
  /** Zero-based position. `stash@{0}` is the most recent. */
  index: number;
  /** Full ref, e.g. `stash@{0}`. */
  ref: string;
  /** Stash subject line (the message given to `git stash push`, or
   *  git's auto-generated `WIP on …` form). */
  message: string;
};

/** Response body for GET /api/git/stashes. */
export type GitStashList = {
  stashes: GitStash[];
};

/** Request body for POST /api/git/checkout and /api/git/stash/drop. */
export type GitCheckoutRequest = {
  sessionId?: string;
  branch: string;
};

export type GitStashPushRequest = {
  sessionId?: string;
  /** Optional human-readable label; git uses `WIP on <branch>: …` when
   *  omitted. */
  message?: string;
  /** Include untracked files (`git stash -u`). Defaults to true — the
   *  common "stash everything" workflow is one click. */
  includeUntracked?: boolean;
};

export type GitStashRefRequest = {
  sessionId?: string;
  /** Stash index (0 = most recent). */
  index: number;
};

export type GitSessionRequest = {
  sessionId?: string;
};
