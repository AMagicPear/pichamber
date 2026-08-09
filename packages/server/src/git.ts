/**
 * Git operations for the Git pane.
 *
 * All commands run inside the active workspace (`git -C <workspace>`), so
 * paths are always workspace-relative and git itself scopes them — no
 * extra containment check needed (unlike fs.ts, which must guard raw
 * filesystem access).
 *
 * The client never has to parse porcelain output: the server turns
 * `git status` into a structured GitChange list and hands diffs back as
 * text, keeping status codes and quoting rules server-side.
 */
import type { GitChange, GitStatus } from "@pichamber/shared";
import { getWorkspace } from "./workspace";
import { WorkspaceError } from "./fs";

type GitResult = { stdout: string; stderr: string; code: number };

const runGit = async (args: string[]): Promise<GitResult> => {
  const proc = Bun.spawn(["git", "-C", getWorkspace(), ...args], {
    stdout: "pipe",
    stderr: "pipe",
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

/**
 * Parse `git status --porcelain=v1 -b`. First line is `## <branch>…`,
 * remaining lines are two-character status codes + path.
 */
export const parseStatus = (stdout: string): GitStatus => {
  const lines = stdout.split("\n").filter(Boolean);
  let branch: string | null = null;
  const changes: GitChange[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      branch = line.slice(3).split("...")[0] || null;
      continue;
    }
    if (line.length < 4) continue;

    const [index, worktree] = [line[0], line[1]];
    let path = line.slice(3);
    // Renames/copies are `old -> new`; we surface the destination path.
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);

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

export const getStatus = async (): Promise<GitStatus> => {
  const result = await runGit(["status", "--porcelain=v1", "-b"]);
  assertOk(result);
  return parseStatus(result.stdout);
};

export const getDiff = async (path: string, staged: boolean): Promise<string> => {
  const args = ["diff", ...(staged ? ["--cached"] : []), "--", path];
  const result = await runGit(args);
  assertOk(result);
  return result.stdout;
};

export const stagePaths = async (paths?: string[]): Promise<void> => {
  const args = paths && paths.length > 0 ? ["add", "--", ...paths] : ["add", "-A"];
  const result = await runGit(args);
  assertOk(result);
};

export const unstagePaths = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const result = await runGit(["restore", "--staged", "--", ...paths]);
  assertOk(result);
};

export const commit = async (message: string): Promise<void> => {
  if (!message.trim()) {
    throw new WorkspaceError("Commit message is required", 400);
  }
  // `git commit -m` treats the arg as a single message regardless of
  // newlines; passing it as one argv element keeps multi-line messages safe.
  const result = await runGit(["commit", "-m", message]);
  assertOk(result);
};
