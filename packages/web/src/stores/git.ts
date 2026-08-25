/**
 * Shared git branch state for the header chip.
 *
 * The header's branch badge only needs the branch name, but it used to
 * call the full `/api/git/status` (a `git status` porcelain round-trip)
 * on its own, independently of the Git pane that already owns git state.
 * Module-level ref so the header and the pane read (and refresh) the
 * same value — one source of truth, no `git status` fired twice per
 * session/cwd change.
 */
import { ref, watch } from "vue";
import { getGitStatus } from "@/api/client";
import { workspace } from "@/stores/workspace";

/** Current branch name, or `null` when the active workspace isn't a repo. */
export const activeGitBranch = ref<string | null>(null);

let loadPromise: Promise<void> | null = null;

/** Refresh the branch chip. Concurrent callers share one request. */
export const loadGitBranch = (): Promise<void> => {
  if (loadPromise) return loadPromise;
  if (!workspace.sessionId) {
    activeGitBranch.value = null;
    return Promise.resolve();
  }
  loadPromise = getGitStatus(workspace.sessionId)
    .then((status) => {
      activeGitBranch.value = status.branch;
    })
    .catch(() => {
      activeGitBranch.value = null;
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
};

/** Let the Git pane push its freshest branch after a status/checkout. */
export const setGitBranch = (branch: string | null) => {
  activeGitBranch.value = branch;
};

// Re-fetch when the session workspace changes — branch belongs to the
// active cwd, and the header is visible even before the Git pane is.
watch(
  () => [workspace.sessionId, workspace.cwd],
  () => {
    void loadGitBranch();
  },
);
