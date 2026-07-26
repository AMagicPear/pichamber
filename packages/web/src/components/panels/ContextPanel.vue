<script setup lang="ts">
/**
 * Right-side context panel. Hosts the git / files / context tabs.
 *
 * Switching tabs uses Transition + KeepAlive. This means:
 *   - FileTree keeps its expanded/loaded state when you tab away and back.
 *   - No re-fetch on tab switch (the FileTree instance is cached).
 *   - No vertical "jump" because each pane fills the same body container.
 *
 * Only the `files` tab has real data; git and context are placeholders
 * for now.
 */
import { computed, ref } from "vue";
import FileListIcon from "@/assets/icons/FileList2.svg";
import FolderIcon from "@/assets/icons/Folder.svg";
import GitBranchIcon from "@/assets/icons/GitBranch.svg";
import ContextPane from "@/components/workspace/ContextPane.vue";
import FilesPane from "@/components/workspace/FilesPane.vue";
import GitPane from "@/components/workspace/GitPane.vue";

const tabs = [
  {
    id: "git",
    label: "git",
    icon: GitBranchIcon,
    component: GitPane,
  },
  {
    id: "files",
    label: "files",
    icon: FolderIcon,
    component: FilesPane,
  },
  {
    id: "context",
    label: "context",
    icon: FileListIcon,
    component: ContextPane,
  },
] as const;

type Tab = (typeof tabs)[number]["id"];

const activeTab = ref<Tab>("files");
const activeTabConfig = computed(() => tabs.find((tab) => tab.id === activeTab.value)!);
</script>

<template>
  <aside class="context-panel">
    <nav class="context-panel__tabs" role="tablist">
      <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id"
        :class="{ 'is-active': activeTab === tab.id }" @click="activeTab = tab.id">
        <component :is="tab.icon" /><span>{{ tab.label }}</span>
      </button>
    </nav>

    <div class="context-panel__body">
      <Transition name="context-pane" mode="out-in">
        <KeepAlive>
          <component :is="activeTabConfig.component" :key="activeTab" />
        </KeepAlive>
      </Transition>
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
  /* Container queries let the tab strip decide on its own when labels
     no longer fit — no JS needed. Threshold sits a hair above the
     right-pane min (200px) so labels still show at the very minimum. */
  container-type: inline-size;
  container-name: right-panel;
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
  transition: margin 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
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
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    padding 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
    gap 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
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

.context-panel__tabs button>span {
  max-width: 100px;
  overflow: hidden;
  white-space: nowrap;
  transition:
    max-width 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 100ms ease;
}

@container right-panel (max-width: 220px) {
  .context-panel__tabs {
    margin-inline: 6px;
  }

  .context-panel__tabs button {
    padding: 0;
    gap: 0;
  }

  .context-panel__tabs button>span {
    max-width: 0;
    opacity: 0;
  }
}

/* ── Body & panes ──────────────────────────────────────────────────── */
.context-panel__body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.context-pane-enter-active,
.context-pane-leave-active {
  transition:
    opacity 90ms ease,
    transform 100ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.context-pane-enter-from,
.context-pane-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

@media (prefers-reduced-motion: reduce) {

  .context-panel__tabs,
  .context-panel__tabs button,
  .context-panel__tabs button>span,
  .context-pane-enter-active,
  .context-pane-leave-active {
    transition: none;
  }
}
</style>

<!-- 下面的这些样式是被三个子页面共用的 不要scoped -->
<style>
.context-panel__pane {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
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

.context-panel__empty>svg {
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
