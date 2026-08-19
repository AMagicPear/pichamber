/**
 * Git operations for the Git pane.
 *
 * Every command runs in the caller-supplied cwd (the session's workspace,
 * mirroring the files panel) — `git -C <cwd>` scopes paths, so they stay
 * workspace-relative and git itself handles containment.
 *
 * The client never has to parse porcelain output: the server turns
 * `git status` into a structured GitChange list and hands diffs back as
 * text, keeping status codes and quoting rules server-side.
 */
import type { GitChange, GitStatus } from "@pichamber/shared";
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

export const commit = async (cwd: string | undefined, message: string): Promise<void> => {
  if (!message.trim()) {
    throw new WorkspaceError("Commit message is required", 400);
  }
  // `git commit -m` treats the arg as a single message regardless of
  // newlines; passing it as one argv element keeps multi-line messages safe.
  const result = await runGit(cwd, ["commit", "-m", message]);
  assertOk(result);
};
