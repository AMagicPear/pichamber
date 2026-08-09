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
import RefreshIcon from "@/assets/icons/Refresh2.svg";
import IconButton from "@/components/IconButton.vue";
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

const stageAll = async () => {
  error.value = null;
  try {
    await stageGitPaths();
    await load();
  } catch (err) {
    error.value = toMessage(err);
  }
};

const unstageAll = async () => {
  const staged = status.value?.changes.filter((c) => c.staged).map((c) => c.path) ?? [];
  error.value = null;
  try {
    await unstageGitPaths(staged);
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

const badge = (change: GitChange): string =>
  ({ modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "?" })[change.status];

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
      <div class="git-pane__header">
        <span class="git-pane__branch">
          <GitBranchIcon />
          {{ status?.branch ?? "—" }}
        </span>
        <IconButton size="compact" label="Refresh" :disabled="loading" @click="load">
          <RefreshIcon />
        </IconButton>
      </div>

      <div class="git-pane__stage-actions">
        <button type="button" class="git-pane__btn" :disabled="!hasChanges" @click="stageAll">
          Stage all
        </button>
        <button type="button" class="git-pane__btn" :disabled="!hasStaged" @click="unstageAll">
          Unstage all
        </button>
      </div>

      <ul v-if="hasChanges" class="git-pane__list">
        <li v-for="change in status?.changes" :key="change.path" class="git-pane__item">
          <input
            type="checkbox"
            class="git-pane__checkbox"
            :checked="change.staged"
            :aria-label="`${change.staged ? 'Unstage' : 'Stage'} ${change.path}`"
            @change="toggleStaged(change)"
          />
          <button
            type="button"
            class="git-pane__row"
            :class="{ 'is-selected': selected?.path === change.path }"
            @click="select(change)"
          >
            <span class="git-pane__badge" :class="`git-pane__badge--${change.status}`">
              {{ badge(change) }}
            </span>
            <span class="git-pane__path">{{ change.path }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="git-pane__state">Clean working tree</p>
      <p v-if="error" class="git-pane__state git-pane__state--error">{{ error }}</p>

      <div class="git-pane__diff">
        <pre v-if="diff" class="git-pane__diff-text">{{ diff }}</pre>
        <p v-else-if="diffLoading" class="git-pane__diff-empty">Loading diff…</p>
        <p v-else-if="selected" class="git-pane__diff-empty">
          {{ selected.status === "untracked" ? "Untracked file — no diff yet" : "No changes" }}
        </p>
        <p v-else class="git-pane__diff-empty">Select a file to view its diff</p>
      </div>

      <div class="git-pane__commit">
        <textarea
          v-model="commitMsg"
          class="git-pane__commit-input"
          placeholder="Commit message"
          rows="2"
          @keydown.ctrl.enter="commit"
        />
        <button
          type="button"
          class="git-pane__btn git-pane__btn--primary"
          :disabled="!hasStaged || !commitMsg.trim() || committing"
          @click="commit"
        >
          {{ committing ? "Committing…" : "Commit" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.git-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.git-pane__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid #ededed;
}
.git-pane__branch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
}
.git-pane__branch svg {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  color: #888;
}
.git-pane__stage-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  padding: 6px 10px;
}
.git-pane__btn {
  height: 26px;
  padding: 0 10px;
  border: 1px solid #d9d7cf;
  border-radius: 6px;
  background: #fff;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.git-pane__btn:hover:not(:disabled) {
  background: rgb(0 0 0 / 4%);
}
.git-pane__btn--primary {
  border-color: #3978d4;
  color: #3978d4;
  font-weight: 500;
}
.git-pane__btn--primary:hover:not(:disabled) {
  background: rgb(57 120 212 / 8%);
}
.git-pane__btn:disabled {
  cursor: default;
  opacity: 0.45;
}
.git-pane__list {
  flex: 0 1 auto;
  max-height: 180px;
  min-height: 0;
  margin: 0;
  padding: 4px 8px;
  list-style: none;
  overflow-y: auto;
}
.git-pane__item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.git-pane__checkbox {
  flex: 0 0 auto;
  accent-color: #222;
}
.git-pane__row {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.git-pane__row:hover {
  background: rgb(0 0 0 / 4%);
}
.git-pane__row.is-selected {
  background: rgb(57 120 212 / 10%);
}
.git-pane__badge {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
}
.git-pane__badge--modified {
  background: rgb(217 147 108 / 18%);
  color: #8a5a33;
}
.git-pane__badge--added {
  background: rgb(122 160 91 / 18%);
  color: #4f6d38;
}
.git-pane__badge--deleted {
  background: rgb(201 111 111 / 18%);
  color: #8c4444;
}
.git-pane__badge--renamed {
  background: rgb(122 155 201 / 18%);
  color: #3f5f8c;
}
.git-pane__badge--untracked {
  background: rgb(0 0 0 / 8%);
  color: #666;
}
.git-pane__path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-pane__state {
  margin: 0;
  padding: 10px;
  color: #888;
  font-size: 12px;
}
.git-pane__state--error {
  color: #a33;
}
.git-pane__diff {
  flex: 1 1 0;
  min-height: 0;
  margin: 0 8px;
  border: 1px solid #ededed;
  border-radius: 8px;
  background: #f7f7f5;
  overflow: auto;
}
.git-pane__diff-text {
  margin: 0;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
}
.git-pane__diff-empty {
  margin: 0;
  padding: 16px 10px;
  color: #999;
  font-size: 12px;
  text-align: center;
}
.git-pane__commit {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid #ededed;
}
.git-pane__commit-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid #dfddd4;
  border-radius: 6px;
  outline: 0;
  resize: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  background: #fff;
}
.git-pane__commit-input:focus {
  border-color: #3978d4;
}
.git-pane__commit-input::placeholder {
  color: #999;
}
</style>
