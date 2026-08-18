<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { GitChange, GitStatus } from "@pichamber/shared";
import {
  commitGit,
  getGitDiff,
  getGitStatus,
  stageGitPaths,
  toMessage,
  unstageGitPaths,
} from "@/api/client";
import GitBranchIcon from "@/assets/icons/GitBranch.svg";
import PlusIcon from "@/assets/icons/AddCircle.svg";
import RefreshIcon from "@/assets/icons/Refresh2.svg";
import DiffView from "@/components/workspace/DiffView.vue";
import IconButton from "@/components/IconButton.vue";
import FilePathLabel from "@/components/FilePathLabel.vue";
import { workspace } from "@/stores/workspace";

const status = ref<GitStatus | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const selected = ref<GitChange | null>(null);
const diff = ref("");
const diffError = ref<string | null>(null);
const diffLoading = ref(false);
const commitMsg = ref("");
const committing = ref(false);

const load = async () => {
  loading.value = true;
  error.value = null;
  try {
    status.value = await getGitStatus(workspace.sessionId);
    // Keep the selection in sync: the picked file may have changed/staged
    // state after a git operation.
    if (selected.value) {
      const match = status.value.changes.find((c) => c.path === selected.value?.path);
      if (match) {
        if (match.staged !== selected.value.staged) select(match);
        else selected.value = match;
      } else {
        selected.value = null;
        diff.value = "";
      }
    }
  } catch (err) {
    status.value = null;
    error.value = toMessage(err);
  } finally {
    loading.value = false;
  }
};

const select = async (change: GitChange) => {
  selected.value = change;
  diffLoading.value = true;
  diff.value = "";
  diffError.value = null;
  try {
    if (change.status === "untracked") {
      diff.value = ""; // git has nothing to diff against.
    } else {
      diff.value = (await getGitDiff(workspace.sessionId, change.path, change.staged)).diff;
    }
  } catch (err) {
    diffError.value = toMessage(err);
  } finally {
    diffLoading.value = false;
  }
};

const toggleStaged = async (change: GitChange) => {
  error.value = null;
  try {
    if (change.staged) await unstageGitPaths(workspace.sessionId, [change.path]);
    else await stageGitPaths(workspace.sessionId, [change.path]);
    await load();
  } catch (err) {
    error.value = toMessage(err);
  }
};

const commit = async () => {
  const message = commitMsg.value.trim();
  if (!message || !hasStaged.value) return;
  committing.value = true;
  error.value = null;
  try {
    await commitGit(workspace.sessionId, message);
    commitMsg.value = "";
    await load();
  } catch (err) {
    error.value = toMessage(err);
  } finally {
    committing.value = false;
  }
};

const hasStaged = computed(() => status.value?.changes.some((c) => c.staged) ?? false);
const hasChanges = computed(() => (status.value?.changes.length ?? 0) > 0);

// Single-character status marker, mirroring openchamber's quiet badge
// pattern (one color, character carries meaning). The colored cards we
// used before fought the panel's neutral palette.
const badge = (change: GitChange): string =>
  ({ modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "?" })[change.status];

const badgeTitle = (change: GitChange): string =>
  ({ modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", untracked: "Untracked" })[
  change.status
  ];

// Reload whenever the session workspace changes, so the pane tracks the
// same cwd the files panel and terminal use.
onMounted(load);
watch(() => workspace.cwd, load);
</script>

<template>
  <div class="right-panel__pane" role="tabpanel" aria-label="git">
    <div v-if="!status && error" class="ui-empty-state">
      <GitBranchIcon />
      <p>This directory is not a Git repository</p>
      <span>{{ error }}</span>
    </div>

    <div v-else class="git-pane">
      <!-- Branch bar: matches openchamber's branch row (icon + name on the
           left, sync-class controls on the right). -->
      <div class="git-pane__branch">
        <span class="git-pane__branch-name">
          <GitBranchIcon />
          {{ status?.branch ?? "—" }}
        </span>
        <IconButton size="compact" label="Refresh" :disabled="loading" @click="load">
          <RefreshIcon />
        </IconButton>
      </div>

      <!-- Changes section -->
      <section class="git-pane__section">
        <header class="git-pane__section-header">
          <h3 class="git-pane__section-title ui-section-title">
            Changes
            <span v-if="hasChanges" class="git-pane__count">{{ status?.changes.length }}</span>
          </h3>
        </header>

        <ul v-if="hasChanges" class="git-pane__list">
          <li v-for="change in status?.changes" :key="change.path" class="git-pane__row"
            :class="{ 'is-selected': selected?.path === change.path, 'is-staged': change.staged }">
            <button type="button" class="git-pane__stage-toggle"
              :aria-label="`${change.staged ? 'Unstage' : 'Stage'} ${change.path}`" :aria-pressed="change.staged"
              :title="change.staged ? 'Unstage' : 'Stage'" @click="toggleStaged(change)">
              <PlusIcon />
            </button>
            <button type="button" class="git-pane__file ui-list-row" :title="change.path" @click="select(change)">
              <span class="git-pane__badge" :title="badgeTitle(change)">{{ badge(change) }}</span>
              <FilePathLabel class="git-pane__file-label" :path="change.path" />
            </button>
          </li>
        </ul>
        <p v-else class="git-pane__state">Clean working tree</p>
        <p v-if="error" class="git-pane__state git-pane__state--error">{{ error }}</p>
      </section>

      <!-- Diff preview -->
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

      <!-- Commit section: title + sub-text + input + primary action,
           matching openchamber's "Commit" block. -->
      <section class="git-pane__section git-pane__section--commit">
        <header class="git-pane__section-header">
          <h3 class="git-pane__section-title ui-section-title">
            Commit
            <span v-if="!hasStaged" class="git-pane__hint">Stage files to enable commit.</span>
          </h3>
        </header>
        <textarea v-model="commitMsg" class="git-pane__commit-input ui-input" placeholder="Commit message" rows="3"
          @keydown.ctrl.enter="commit" />
        <div class="git-pane__commit-actions">
          <button type="button" class="git-pane__btn git-pane__btn--primary"
            :disabled="!hasStaged || !commitMsg.trim() || committing" @click="commit">
            {{ committing ? "Committing…" : "Commit" }}
          </button>
        </div>
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
  /* Auto-scroll only when the pane is too short for the minimum
   * content (branch + changes + diff + commit). Normally each section
   * scrolls internally, so the pane itself has no scrollbar. */
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
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}

.git-pane__branch-name svg {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--ui-text-muted);
}

/* ── Section frames ───────────────────────────────────────────────── */
.git-pane__section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Clip any inner overflow (e.g. a long change list when the pane is
     short) so the section's allocated size is what the user sees; the
     rest is reachable via the pane's own scroll. */
  overflow: hidden;
}
.git-pane__section:not(.git-pane__section--diff):not(.git-pane__section--commit) {
  flex: 0 1 auto;
}

.git-pane__section--diff {
  /* The diff section absorbs the leftover vertical space so the diff
   * view is constrained by the pane rather than by its own content. */
  flex: 1 1 0;
  min-height: 120px;
}
.git-pane__section--diff :deep(.diff-view) {
  /* Fill the section and scroll internally; do not let the patch
   * surface decide the section height. */
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

.git-pane__section--commit {
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

/* ── Changes list ────────────────────────────────────────────────── */
.git-pane__list {
  max-height: 30vh;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  /* No internal scroll: the whole .git-pane scrolls as a single
     surface, so the user never has to guess which scrollbar belongs
     to which section. The section's overflow:hidden clips the tail
     when the change list is taller than its allocated slice. */
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

/* Stage toggle: mirrors openchamber's `+` icon. aria-pressed is the
   public signal for the staged state so screen readers don't lose
   meaning when we swap the visual. */
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

/* File row: badge + icon + path, sitting on the same baseline as the
   stage toggle so the whole row reads as one unit. */
.git-pane__file {
  flex: 1 1 auto;
  min-width: 0;
  gap: 7px;
  padding: 0 6px;
}

.git-pane__file:focus-visible,
.git-pane__stage-toggle:focus-visible {
  outline: 2px solid #3978d4;
  outline-offset: -2px;
}

/* The letter carries the status meaning without adding a separate color
   system to the pane. */
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
  /* Same scroll-box look as DiffView's .diff-view, so the empty state
     fills the slot the same way the populated diff would. */
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

.git-pane__btn {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 5px;
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.git-pane__btn--primary {
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}

.git-pane__btn--primary:hover:not(:disabled) {
  background: var(--ui-surface-selected);
}

.git-pane__btn:disabled {
  cursor: default;
  opacity: 0.5;
}

</style>
