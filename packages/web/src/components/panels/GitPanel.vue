<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type {
  GitBranch,
  GitBranchList,
  GitChange,
  GitStashList,
  GitStatus,
} from "@pichamber/shared";
import {
  checkoutGitBranch,
  commitGit,
  discardGitPaths,
  getGitDiff,
  getGitStatus,
  initGitRepo,
  listGitBranches,
  listGitStashes,
  popGitStash,
  pullGit,
  pushGit,
  pushGitStash,
  dropGitStash,
  stageGitPaths,
  toMessage,
  unstageGitPaths,
} from "@/api/client";
import GitBranchIcon from "@/assets/icons/GitBranch.svg";
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";
import ArrowUpSIcon from "@/assets/icons/ArrowUpS.svg";
import DeleteBinIcon from "@/assets/icons/DeleteBin.svg";
import RefreshIcon from "@/assets/icons/Refresh2.svg";
import StackIcon from "@/assets/icons/Stack.svg";
import PlusIcon from "@/assets/icons/AddCircle.svg";
import DiffView from "@/components/workspace/DiffView.vue";
import IconButton from "@/components/IconButton.vue";
import FilePathLabel from "@/components/FilePathLabel.vue";
import MenuPanel from "@/components/MenuPanel.vue";
import { usePopover } from "@/composables/usePopover";
import { workspace } from "@/stores/workspace";

type SyncKind = "pull" | "push" | "stash" | "stash-pop" | "stash-drop" | "init" | "checkout";

const status = ref<GitStatus | null>(null);
const branches = ref<GitBranchList | null>(null);
const stashes = ref<GitStashList | null>(null);

/** Last surfaced message per operation. Kept distinct from `error`
 *  (working-tree level) so the panel can label the context. */
const statusError = ref<string | null>(null);
const syncError = ref<string | null>(null);

const loading = ref(false);
const syncBusy = ref<SyncKind | null>(null);

const selected = ref<GitChange | null>(null);
const diff = ref("");
const diffError = ref<string | null>(null);
const diffLoading = ref(false);

const commitMsg = ref("");
const committing = ref(false);

const stashMsg = ref("");

const isRepo = computed(() => status.value !== null);

// ── Branch switcher popover ──────────────────────────────────────────
const branchRoot = ref<HTMLElement | null>(null);
const {
  open: branchMenuOpen,
  style: branchMenuStyle,
  toggle: toggleBranchMenu,
  close: closeBranchMenu,
} = usePopover({
  root: branchRoot,
  trigger: ".git-pane__branch-trigger",
  panel: ".menu-panel",
  width: 280,
  height: 320,
  onOpen: () => {
    // Lazy-fetch the branch list the first time the menu opens so
    // users with no remote don't pay for the for-each-ref roundtrip.
    if (!branches.value) void loadBranches();
  },
});

const localBranches = computed(() => branches.value?.branches.filter((b) => !b.remote) ?? []);
const remoteBranches = computed(() => branches.value?.branches.filter((b) => b.remote) ?? []);

const selectBranch = async (branch: GitBranch) => {
  closeBranchMenu();
  if (branch.current) return;
  await runSync("checkout", () => checkoutGitBranch(workspace.sessionId, branch.name).then(reloadAfterSync));
};

// ── Load helpers ─────────────────────────────────────────────────────
const loadStatus = async (): Promise<void> => {
  loading.value = true;
  try {
    const next = await getGitStatus(workspace.sessionId);
    status.value = next;
    statusError.value = null;
    if (selected.value) {
      const match = next.changes.find((c) => c.path === selected.value?.path);
      if (match) {
        if (match.staged !== selected.value.staged) await select(match);
        else selected.value = match;
      } else {
        selected.value = null;
        diff.value = "";
      }
    }
    // Branch list may have changed (we switched); refetch in background.
    if (branches.value) void loadBranches();
  } catch (err) {
    status.value = null;
    statusError.value = toMessage(err);
  } finally {
    loading.value = false;
  }
};

const loadBranches = async (): Promise<void> => {
  try {
    branches.value = await listGitBranches(workspace.sessionId);
  } catch {
    // Not a repo or git unavailable; surface via statusError instead.
  }
};

const loadStashes = async (): Promise<void> => {
  try {
    stashes.value = await listGitStashes(workspace.sessionId);
  } catch (err) {
    stashes.value = { stashes: [] };
    syncError.value = toMessage(err);
  }
};

const load = async () => {
  await Promise.all([loadStatus(), loadStashes()]);
};

const reloadAfterSync = async (next?: unknown) => {
  if (next && typeof next === "object" && "stashes" in next) {
    stashes.value = next as GitStashList;
  }
  await loadStatus();
  await loadStashes();
};

// ── Selection / diff ─────────────────────────────────────────────────
const select = async (change: GitChange) => {
  selected.value = change;
  diffLoading.value = true;
  diff.value = "";
  diffError.value = null;
  try {
    if (change.status === "untracked") diff.value = "";
    else diff.value = (await getGitDiff(workspace.sessionId, change.path, change.staged)).diff;
  } catch (err) {
    diffError.value = toMessage(err);
  } finally {
    diffLoading.value = false;
  }
};

// ── Per-row actions ──────────────────────────────────────────────────
const toggleStaged = async (change: GitChange) => {
  syncError.value = null;
  try {
    if (change.staged) await unstageGitPaths(workspace.sessionId, [change.path]);
    else await stageGitPaths(workspace.sessionId, [change.path]);
    await loadStatus();
  } catch (err) {
    syncError.value = toMessage(err);
  }
};

const discard = async (change: GitChange) => {
  syncError.value = null;
  try {
    await discardGitPaths(workspace.sessionId, [change.path]);
    if (selected.value?.path === change.path) selected.value = null;
    await load();
  } catch (err) {
    syncError.value = toMessage(err);
  }
};

const commit = async () => {
  const message = commitMsg.value.trim();
  if (!message || !hasStaged.value) return;
  committing.value = true;
  syncError.value = null;
  try {
    await commitGit(workspace.sessionId, message);
    commitMsg.value = "";
    await load();
  } catch (err) {
    syncError.value = toMessage(err);
  } finally {
    committing.value = false;
  }
};

// ── Sync actions (push/pull/stash/init) ──────────────────────────────
const runSync = async <T>(kind: SyncKind, op: () => Promise<T>): Promise<T | undefined> => {
  syncError.value = null;
  syncBusy.value = kind;
  try {
    return await op();
  } catch (err) {
    syncError.value = toMessage(err);
    return undefined;
  } finally {
    syncBusy.value = null;
  }
};

const doInit = () =>
  runSync("init", () => initGitRepo(workspace.sessionId).then((next) => {
    status.value = next;
    void loadBranches();
    void loadStashes();
  }));

const doPull = () => runSync("pull", () => pullGit(workspace.sessionId).then(reloadAfterSync));
const doPush = () => runSync("push", () => pushGit(workspace.sessionId).then(reloadAfterSync));

const doStashPush = () =>
  runSync("stash", () => pushGitStash(workspace.sessionId, stashMsg.value.trim() || undefined).then((next) => {
    stashMsg.value = "";
    reloadAfterSync(next);
  }));

const doStashPop = () => runSync("stash-pop", () => popGitStash(workspace.sessionId).then(reloadAfterSync));

const doStashDrop = (index: number) =>
  runSync("stash-drop", () => dropGitStash(workspace.sessionId, index).then(reloadAfterSync));

// ── Computed display values ──────────────────────────────────────────
const hasStaged = computed(() => status.value?.changes.some((c) => c.staged) ?? false);
const hasChanges = computed(() => (status.value?.changes.length ?? 0) > 0);
const hasStashes = computed(() => (stashes.value?.stashes.length ?? 0) > 0);

const badge = (change: GitChange): string =>
  ({ modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "?" })[change.status];

const badgeTitle = (change: GitChange): string =>
  ({ modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", untracked: "Untracked" })[
  change.status
  ];

// Reload whenever the session workspace changes, so the pane tracks the
// same cwd the files panel and terminal use. Also reload branch/stash
// data so post-switch state is fresh.
onMounted(load);
watch(() => workspace.cwd, () => {
  branches.value = null;
  load();
});
</script>

<template>
  <div class="right-panel__pane" role="tabpanel" aria-label="git">
    <!-- ── Not a git repository: offer one-click init ──────────── -->
    <div v-if="!isRepo" class="ui-empty-state">
      <GitBranchIcon />
      <p>This directory is not a Git repository</p>
      <span>{{ statusError }}</span>
      <button
        type="button"
        class="git-pane__btn git-pane__btn--primary"
        :disabled="syncBusy === 'init'"
        @click="doInit"
      >
        {{ syncBusy === "init" ? "Initializing…" : "Initialize repository" }}
      </button>
    </div>

    <div v-else class="git-pane">
      <!-- ── Branch bar: name + sync actions + branch switcher ── -->
      <div class="git-pane__branch">
        <div ref="branchRoot" class="git-pane__branch-name">
          <button
            type="button"
            class="git-pane__branch-trigger"
            :aria-expanded="branchMenuOpen"
            aria-haspopup="menu"
            @click="toggleBranchMenu"
          >
            <GitBranchIcon />
            <span class="git-pane__branch-label">{{ status?.branch ?? "—" }}</span>
            <ArrowDownSIcon class="git-pane__branch-chevron" />
          </button>
          <MenuPanel :open="branchMenuOpen" :style="branchMenuStyle" :width="280" :height="320" role="menu">
            <div class="git-pane__menu-header">Local branches</div>
            <div v-if="branches && localBranches.length === 0" class="git-pane__menu-empty">
              No local branches
            </div>
            <button
              v-for="branch in localBranches"
              :key="branch.name"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'is-active': branch.current }"
              :disabled="branch.current || syncBusy === 'checkout'"
              @click="selectBranch(branch)"
            >
              <span class="git-pane__menu-branch-name">{{ branch.name }}</span>
              <span v-if="branch.upstream" class="git-pane__menu-branch-meta">
                {{ branch.track || "↑↓" }}
              </span>
            </button>
            <template v-if="remoteBranches.length > 0">
              <div class="git-pane__menu-header">Remote tracking</div>
              <button
                v-for="branch in remoteBranches"
                :key="branch.name"
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="syncBusy === 'checkout'"
                @click="selectBranch(branch)"
              >
                <span class="git-pane__menu-branch-name">{{ branch.name }}</span>
              </button>
            </template>
          </MenuPanel>
        </div>

        <div class="git-pane__sync">
          <IconButton
            size="compact"
            label="Pull"
            :disabled="syncBusy !== null"
            @click="doPull"
          >
            <ArrowDownSIcon v-if="syncBusy !== 'pull'" />
            <span v-else class="git-pane__busy">…</span>
          </IconButton>
          <IconButton
            size="compact"
            label="Push"
            :disabled="syncBusy !== null"
            @click="doPush"
          >
            <ArrowUpSIcon v-if="syncBusy !== 'push'" />
            <span v-else class="git-pane__busy">…</span>
          </IconButton>
          <IconButton size="compact" label="Refresh" :disabled="loading" @click="load">
            <RefreshIcon />
          </IconButton>
        </div>
      </div>

      <!-- ── Changes ──────────────────────────────────────────── -->
      <section class="git-pane__section">
        <header class="git-pane__section-header">
          <h3 class="git-pane__section-title ui-section-title">
            Changes
            <span v-if="hasChanges" class="git-pane__count">{{ status?.changes.length }}</span>
          </h3>
        </header>

        <ul v-if="hasChanges" class="git-pane__list">
          <li
            v-for="change in status?.changes"
            :key="change.path"
            class="git-pane__row"
            :class="{ 'is-selected': selected?.path === change.path, 'is-staged': change.staged }"
          >
            <button
              type="button"
              class="git-pane__stage-toggle"
              :aria-label="`${change.staged ? 'Unstage' : 'Stage'} ${change.path}`"
              :aria-pressed="change.staged"
              :title="change.staged ? 'Unstage' : 'Stage'"
              @click="toggleStaged(change)"
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              class="git-pane__file ui-list-row"
              :title="change.path"
              @click="select(change)"
            >
              <span class="git-pane__badge" :title="badgeTitle(change)">{{ badge(change) }}</span>
              <FilePathLabel class="git-pane__file-label" :path="change.path" />
            </button>
            <button
              type="button"
              class="git-pane__discard"
              :aria-label="`Discard changes to ${change.path}`"
              :title="`Discard changes to ${change.path}`"
              @click="discard(change)"
            >
              <DeleteBinIcon />
            </button>
          </li>
        </ul>
        <p v-else class="git-pane__state">Clean working tree</p>
        <p v-if="statusError" class="git-pane__state git-pane__state--error">{{ statusError }}</p>
      </section>

      <!-- ── Diff ─────────────────────────────────────────────── -->
      <section class="git-pane__section git-pane__section--diff">
        <header class="git-pane__section-header">
          <h3 class="git-pane__section-title ui-section-title">Diff</h3>
        </header>
        <DiffView v-if="diff" :patch="diff" />
        <p v-else-if="diffError" class="git-pane__diff-empty git-pane__diff-empty--error">
          {{ diffError }}
        </p>
        <p v-else-if="diffLoading" class="git-pane__diff-empty">Loading diff…</p>
        <p v-else-if="selected" class="git-pane__diff-empty">
          {{ selected.status === "untracked" ? "Untracked file — no diff yet" : "No changes" }}
        </p>
        <p v-else class="git-pane__diff-empty">Select a file to view its diff</p>
      </section>

      <!-- ── Commit ───────────────────────────────────────────── -->
      <section class="git-pane__section git-pane__section--commit">
        <header class="git-pane__section-header">
          <h3 class="git-pane__section-title ui-section-title">
            Commit
            <span v-if="!hasStaged" class="git-pane__hint">Stage files to enable commit.</span>
          </h3>
        </header>
        <textarea
          v-model="commitMsg"
          class="git-pane__commit-input ui-input"
          placeholder="Commit message"
          rows="3"
          @keydown.ctrl.enter="commit"
        />
        <div class="git-pane__commit-actions">
          <button
            type="button"
            class="git-pane__btn git-pane__btn--primary"
            :disabled="!hasStaged || !commitMsg.trim() || committing"
            @click="commit"
          >
            {{ committing ? "Committing…" : "Commit" }}
          </button>
        </div>
      </section>

      <!-- ── Stash ────────────────────────────────────────────── -->
      <section class="git-pane__section git-pane__section--stash">
        <header class="git-pane__section-header">
          <h3 class="git-pane__section-title ui-section-title">
            <StackIcon class="git-pane__stash-icon" />
            Stash
          </h3>
        </header>
        <div class="git-pane__stash-form">
          <input
            v-model="stashMsg"
            type="text"
            class="git-pane__stash-input ui-input"
            placeholder="Optional message"
            @keydown.enter="doStashPush"
          />
          <button
            type="button"
            class="git-pane__btn"
            :disabled="syncBusy !== null"
            @click="doStashPush"
          >
            {{ syncBusy === "stash" ? "…" : "Stash" }}
          </button>
        </div>
        <ul v-if="hasStashes" class="git-pane__stash-list">
          <li v-for="entry in stashes?.stashes" :key="entry.ref" class="git-pane__stash-row">
            <span class="git-pane__stash-message" :title="entry.message">
              {{ entry.message || entry.ref }}
            </span>
            <div class="git-pane__stash-actions">
              <button
                type="button"
                class="git-pane__btn git-pane__btn--small"
                :disabled="syncBusy !== null"
                @click="doStashPop"
              >
                Pop
              </button>
              <button
                type="button"
                class="git-pane__btn git-pane__btn--small git-pane__btn--danger"
                :disabled="syncBusy !== null"
                @click="doStashDrop(entry.index)"
              >
                Drop
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="git-pane__state">No stashed entries</p>
        <p v-if="syncError" class="git-pane__sync-error" :title="syncError">{{ syncError }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.git-pane {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 10px 10px 12px;
  gap: 12px;
  overflow: auto;
}

/* ── Branch bar ───────────────────────────────────────────────────── */
.git-pane__branch {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  gap: 8px;
  padding: 0 4px;
}

.git-pane__branch-name {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
  font-size: 14px;
  font-weight: 500;
}

.git-pane__branch-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  height: 26px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.git-pane__branch-trigger:hover {
  background: var(--ui-surface-hover);
}

.git-pane__branch-trigger:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 1px;
}

.git-pane__branch-trigger svg {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  color: var(--ui-text-muted);
}

.git-pane__branch-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-pane__branch-chevron {
  width: 11px;
  height: 11px;
  flex: 0 0 11px;
  opacity: 0.55;
}

.git-pane__sync {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}

.git-pane__busy {
  display: inline-block;
  min-width: 16px;
  text-align: center;
  color: var(--ui-text-muted);
  font-family: var(--ui-font-mono);
  font-size: 13px;
}

/* Branch switcher menu */
.git-pane__menu-header {
  padding: 6px 10px 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.git-pane__menu-empty {
  padding: 8px 10px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.git-pane__menu-branch-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-pane__menu-branch-meta {
  color: var(--ui-text-muted);
  font-family: var(--ui-font-mono);
  font-size: 11px;
}

/* ── Section frames ───────────────────────────────────────────────── */
.git-pane__section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.git-pane__section:not(.git-pane__section--diff):not(.git-pane__section--commit) {
  flex: 0 1 auto;
}

.git-pane__section--diff {
  flex: 1 1 0;
  min-height: 120px;
}
.git-pane__section--diff :deep(.diff-view) {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
  max-height: none;
  overflow: auto;
}
.git-pane__section--diff .git-pane__diff-empty {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  margin: 0;
}

.git-pane__section--commit,
.git-pane__section--stash {
  flex: 0 0 auto;
}

.git-pane__section-header {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px 5px;
}

.git-pane__section-title {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.git-pane__count {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: normal;
}

.git-pane__hint {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
}

.git-pane__stash-icon {
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
  margin-right: 2px;
  align-self: center;
  color: var(--ui-text-muted);
}

/* ── Changes list ────────────────────────────────────────────────── */
.git-pane__list {
  max-height: 30vh;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.git-pane__row {
  display: flex;
  align-items: center;
  gap: 1px;
  border-radius: var(--ui-radius-md);
  transition: background-color 120ms ease;
}

.git-pane__row:hover {
  background: var(--ui-surface-hover);
}

.git-pane__row.is-selected {
  background: var(--ui-surface-selected);
}

.git-pane__stage-toggle {
  display: inline-flex;
  width: 22px;
  height: 28px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.git-pane__stage-toggle :deep(svg) {
  width: 14px;
  height: 14px;
}

.git-pane__stage-toggle:hover {
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}

.git-pane__row.is-staged .git-pane__stage-toggle {
  color: #3978d4;
}

.git-pane__file {
  flex: 1 1 auto;
  min-width: 0;
  gap: 7px;
  padding: 0 6px;
}

.git-pane__file:focus-visible,
.git-pane__stage-toggle:focus-visible,
.git-pane__discard:focus-visible {
  outline: 2px solid #3978d4;
  outline-offset: -2px;
}

.git-pane__badge {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  background: transparent;
  color: var(--ui-text-muted);
  font-family: var(--ui-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.git-pane__file-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
}

/* Per-row discard button: hidden by default, reveals on row hover/focus
 * so the change list doesn't look busy. Keeps the surface uncluttered. */
.git-pane__discard {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  margin-right: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms ease,
    background-color 120ms ease,
    color 120ms ease;
}

.git-pane__discard :deep(svg) {
  width: 14px;
  height: 14px;
}

.git-pane__row:hover .git-pane__discard,
.git-pane__row.is-selected .git-pane__discard,
.git-pane__discard:focus-visible {
  opacity: 1;
}

.git-pane__discard:hover {
  background: var(--ui-error-hover);
  color: var(--ui-error-strong);
}

.git-pane__state {
  margin: 0;
  padding: 14px 4px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.git-pane__state--error {
  color: #b04848;
}

/* ── Diff preview ────────────────────────────────────────────────── */
.git-pane__diff-empty {
  flex: 1 1 0;
  min-height: 0;
  margin: 0;
  padding: 24px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-align: center;
  display: grid;
  place-items: center;
}

.git-pane__diff-empty--error {
  color: #b04848;
}

/* ── Commit ──────────────────────────────────────────────────────── */
.git-pane__commit-input {
  box-sizing: border-box;
  min-height: 72px;
  padding: 10px 12px;
  resize: none;
}

.git-pane__commit-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

/* ── Stash ───────────────────────────────────────────────────────── */
.git-pane__stash-form {
  display: flex;
  gap: 6px;
}

.git-pane__stash-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  padding: 0 10px;
  font-size: 13px;
}

.git-pane__stash-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.git-pane__stash-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface-subtle);
}

.git-pane__stash-message {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text);
  font-size: 12px;
}

.git-pane__stash-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 4px;
}

.git-pane__sync-error {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: var(--ui-radius-md);
  background: var(--ui-error-hover);
  color: var(--ui-error-strong);
  font-size: 12px;
  /* git's stderr (e.g. "no upstream configured") can be 5+ lines of
   * guidance text; truncate visually but keep the full message in the
   * title attribute so users can hover for the rest. */
  max-height: 5em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  white-space: pre-wrap;
}

/* ── Buttons ─────────────────────────────────────────────────────── */
.git-pane__btn {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 5px;
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.git-pane__btn--small {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}

.git-pane__btn--primary {
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}

.git-pane__btn--danger {
  color: var(--ui-error-strong);
}

.git-pane__btn--primary:hover:not(:disabled) {
  background: var(--ui-surface-selected);
}

.git-pane__btn--danger:hover:not(:disabled) {
  background: var(--ui-error-hover);
}

.git-pane__btn:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>