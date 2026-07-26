<script setup lang="ts">
/**
 * Right-side context panel. Hosts the git / files / context tabs.
 *
 * Switching tabs is a *decorative* change: all three panes stay mounted
 * at all times and we toggle visibility with `v-show`. This means:
 *   - FileTree keeps its expanded/loaded state when you tab away and back.
 *   - No re-fetch on tab switch (no re-mounting FileTree).
 *   - No vertical "jump" — every pane lives in the same `.pane` container
 *     sized to fill the body, so switching is just one pane fading out
 *     and another fading in at the same coordinates.
 *
 * Only the `files` tab has real data; git and context are placeholders
 * for now.
 */
import { ref } from "vue";
import FileListIcon from "@/assets/icons/FileList2.svg";
import FolderIcon from "@/assets/icons/Folder.svg";
import GitBranchIcon from "@/assets/icons/GitBranch.svg";
import FileTree from "@/components/workspace/FileTree.vue";

type Tab = "git" | "files" | "context";

const activeTab = ref<Tab>("files");
</script>

<template>
  <aside class="context-panel">
    <nav class="context-panel__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'git'"
        :class="{ 'is-active': activeTab === 'git' }"
        @click="activeTab = 'git'"
      >
        <GitBranchIcon /><span>git</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'files'"
        :class="{ 'is-active': activeTab === 'files' }"
        @click="activeTab = 'files'"
      >
        <FolderIcon /><span>files</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'context'"
        :class="{ 'is-active': activeTab === 'context' }"
        @click="activeTab = 'context'"
      >
        <FileListIcon /><span>context</span>
      </button>
    </nav>

    <div class="context-panel__body">
      <div
        class="context-panel__pane"
        :hidden="activeTab !== 'git'"
        role="tabpanel"
        aria-label="git"
      >
        <div class="context-panel__empty">
          <GitBranchIcon />
          <p>This directory is not a Git repository</p>
          <span>Initialize Git in this directory or open a repository.</span>
        </div>
      </div>

      <div
        class="context-panel__pane"
        :hidden="activeTab !== 'files'"
        role="tabpanel"
        aria-label="files"
      >
        <FileTree />
      </div>

      <div
        class="context-panel__pane"
        :hidden="activeTab !== 'context'"
        role="tabpanel"
        aria-label="context"
      >
        <div class="context-panel__empty">
          <FileListIcon />
          <p>Context</p>
          <span>Files added to the next message will appear here.</span>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.context-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #171717;
}

/* ── Tabs ─────────────────────────────────────────────────────────── */
/* Compact pill-style tab strip. Height ~36px to match the openchamber
   reference; inactive tabs are quiet, active one gets a soft border. */
.context-panel__tabs {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 0 0 32px;
  margin: 11px 8px 0;
  padding: 3px;
  border-radius: 10px;
  background: #f7f7f5;
}
.context-panel__tabs button {
  display: inline-flex;
  flex: 1 1 0;
  height: 28px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #686868;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}
.context-panel__tabs button:hover {
  background: rgb(255 255 255 / 60%);
  color: #222;
}
.context-panel__tabs button:focus-visible {
  outline: 2px solid #3978d4;
  outline-offset: 1px;
}
.context-panel__tabs button svg {
  width: 16px;
  height: 16px;
}
.context-panel__tabs .is-active {
  border-color: #e2dfd5;
  background: #fff;
  color: #222;
  box-shadow: 0 1px 2px rgb(0 0 0 / 3%);
}
.context-panel__tabs .is-active:hover {
  background: #fff;
}

/* ── Body & panes ──────────────────────────────────────────────────── */
/* All panes are stacked in the same flex container; `hidden` removes
   the inactive ones from layout. They each fill the body identically,
   so switching tabs is purely visual — no vertical reflow. */
.context-panel__body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.context-panel__pane {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.context-panel__pane[hidden] {
  display: none;
}

.context-panel__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
}
.context-panel__empty > svg {
  width: 24px;
  height: 24px;
  margin-bottom: 14px;
  color: #777;
}
.context-panel__empty p {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}
.context-panel__empty span {
  color: #777;
  font-size: 12px;
}
</style>
