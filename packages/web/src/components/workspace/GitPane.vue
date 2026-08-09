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
import UndoIcon from "@/assets/icons/Refresh2.svg";
import IconButton from "@/components/IconButton.vue";
import FilePathLabel from "@/components/FilePathLabel.vue";
import { workspace } from "@/stores/workspace";

const status = ref<GitStatus | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
const selected = ref<GitChange | null>(null);
const diff = ref("");
const diffLoading = ref(false);
const commitMsg = ref("");
const committing = ref(false);

const load = async () => {
  loading.value = true;
  error.value = null;
  try {
    status.value = await getGitStatus();
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
  try {
    if (change.status === "untracked") {
      diff.value = ""; // git has nothing to diff against.
    } else {
      diff.value = (await getGitDiff(change.path, change.staged)).diff;
    }
  } catch (err) {
    diff.value = `// ${toMessage(err)}`;
  } finally {
    diffLoading.value = false;
  }
};

const toggleStaged = async (change: GitChange) => {
  error.value = null;
  try {
    if (change.staged) await unstageGitPaths([change.path]);
    else await stageGitPaths([change.path]);
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
    await commitGit(message);
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
  <div class="context-panel__pane" role="tabpanel" aria-label="git">
    <div v-if="!status && error" class="context-panel__empty">
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
          <h3 class="git-pane__section-title">
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
              class="git-pane__file"
              :title="change.path"
              @click="select(change)"
            >
              <span class="git-pane__badge" :title="badgeTitle(change)">{{ badge(change) }}</span>
              <FilePathLabel class="git-pane__file-label" :path="change.path" />
            </button>
            <button
              type="button"
              class="git-pane__discard"
              :title="`Discard ${change.path}`"
              :aria-label="`Discard ${change.path}`"
              @click="select(change)"
            >
              <UndoIcon />
            </button>
          </li>
        </ul>
        <p v-else class="git-pane__state">Clean working tree</p>
        <p v-if="error" class="git-pane__state git-pane__state--error">{{ error }}</p>
      </section>

      <!-- Diff preview -->
      <section class="git-pane__section git-pane__section--diff">
        <div class="git-pane__diff">
          <pre v-if="diff" class="git-pane__diff-text">{{ diff }}</pre>
          <p v-else-if="diffLoading" class="git-pane__diff-empty">Loading diff…</p>
          <p v-else-if="selected" class="git-pane__diff-empty">
            {{ selected.status === "untracked" ? "Untracked file — no diff yet" : "No changes" }}
          </p>
          <p v-else class="git-pane__diff-empty">Select a file to view its diff</p>
        </div>
      </section>

      <!-- Commit section: title + sub-text + input + primary action,
           matching openchamber's "Commit" block. -->
      <section class="git-pane__section git-pane__section--commit">
        <header class="git-pane__section-header">
          <h3 class="git-pane__section-title">
            Commit
            <span v-if="!hasStaged" class="git-pane__hint">Stage files to enable commit.</span>
          </h3>
        </header>
        <textarea
          v-model="commitMsg"
          class="git-pane__commit-input"
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
    </div>
  </div>
</template>

<style scoped>
.git-pane {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-height: 0;
  /* Tighter gutter than FileTree's: git panel lives inside a context
     panel that already has its own padding. */
  padding: 10px 12px 12px;
  gap: 14px;
}

/* ── Branch bar ───────────────────────────────────────────────────── */
.git-pane__branch {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  /* Same warm-orange accent as the file-tree's folder icon: keeps the
     branch glyph tied to the existing palette without introducing a new
     color. */
  color: #d9936c;
}

/* ── Section frames ───────────────────────────────────────────────── */
.git-pane__section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.git-pane__section--diff {
  flex: 1 1 0;
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
  padding-bottom: 6px;
}
.git-pane__section-title {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #171717;
}
.git-pane__count {
  color: #888;
  font-size: 12px;
  font-weight: 500;
}
.git-pane__hint {
  color: #888;
  font-size: 12px;
  font-weight: 400;
}

/* ── Changes list ────────────────────────────────────────────────── */
.git-pane__list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}
.git-pane__row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 8px;
  transition: background-color 120ms ease;
}
.git-pane__row:hover {
  background: rgb(0 0 0 / 4%);
}
.git-pane__row.is-selected {
  background: rgb(0 0 0 / 6%);
}

/* Stage toggle: mirrors openchamber's `+` icon. aria-pressed is the
   public signal for the staged state so screen readers don't lose
   meaning when we swap the visual. */
.git-pane__stage-toggle {
  display: inline-flex;
  width: 24px;
  height: 28px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #888;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.git-pane__stage-toggle :deep(svg) {
  width: 14px;
  height: 14px;
}
.git-pane__stage-toggle:hover {
  background: rgb(0 0 0 / 5%);
  color: #222;
}
.git-pane__row.is-staged .git-pane__stage-toggle {
  /* When staged, rotate the plus into a checkmark-like emphasis by
     tinting the icon — same blue used by openchamber's untracked badge. */
  color: #3978d4;
}

/* File row: badge + icon + path, sitting on the same baseline as the
   stage toggle so the whole row reads as one unit. */
.git-pane__file {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.git-pane__file:focus-visible,
.git-pane__discard:focus-visible,
.git-pane__stage-toggle:focus-visible {
  outline: 2px solid #3978d4;
  outline-offset: -2px;
}

/* Single-color status badge: openchamber uses the same quiet blue for
   every status, with the letter doing the work. We keep the letters
   but stay monochrome so we don't import a new palette. */
.git-pane__badge {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(57, 120, 212, 0.1);
  color: #3978d4;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.git-pane__file-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
}

/* Discard button: hover-only, mirrors openchamber's right-edge undo icon. */
.git-pane__discard {
  display: inline-flex;
  width: 24px;
  height: 28px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #999;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}
.git-pane__discard :deep(svg) {
  width: 14px;
  height: 14px;
}
.git-pane__row:hover .git-pane__discard,
.git-pane__discard:focus-visible {
  opacity: 1;
}
.git-pane__discard:hover {
  background: rgb(0 0 0 / 5%);
  color: #b04848;
}

.git-pane__state {
  margin: 0;
  padding: 14px 4px;
  color: #888;
  font-size: 13px;
}
.git-pane__state--error {
  color: #b04848;
}

/* ── Diff preview ────────────────────────────────────────────────── */
.git-pane__diff {
  flex: 1 1 0;
  min-height: 120px;
  overflow: auto;
  border-radius: 10px;
  background: #fafaf7;
}
.git-pane__diff-text {
  margin: 0;
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
}
.git-pane__diff-empty {
  margin: 0;
  padding: 24px 12px;
  color: #999;
  font-size: 13px;
  text-align: center;
}

/* ── Commit ──────────────────────────────────────────────────────── */
.git-pane__commit-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #e7e4dc;
  border-radius: 10px;
  outline: 0;
  resize: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  background: #fff;
  transition: border-color 120ms ease;
}
.git-pane__commit-input:focus {
  border-color: #bcbcbc;
}
.git-pane__commit-input::placeholder {
  color: #999;
}
.git-pane__commit-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

/* Primary action: openchamber's commit button uses a soft amber tint
   instead of a solid blue. We don't ship a palette token for that
   shade, so we mix it from the same warm-orange used by the branch
   icon and the file-tree's folder glyph. */
.git-pane__btn {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: #f3ece4;
  color: #6b4a2e;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.git-pane__btn--primary {
  background: #f3ece4;
  color: #6b4a2e;
}
.git-pane__btn--primary:hover:not(:disabled) {
  background: #ebe2d6;
}
.git-pane__btn:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>