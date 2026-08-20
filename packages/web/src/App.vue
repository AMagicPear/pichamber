<script setup lang="ts">
import LayoutLeftIcon from "@/assets/icons/LayoutLeft.svg";
import IconButton from "@/components/IconButton.vue";
import SplitPane from "@/components/layout/SplitPane.vue";
import Modal from "@/components/layout/Modal.vue";
import { ui } from "@/stores/ui";
import SessionHeader from "@/components/panels/SessionHeader.vue";
import SessionSidebar from "@/components/panels/SessionSidebar.vue";
import { RouterView } from "vue-router";
import { computed, defineAsyncComponent, KeepAlive } from "vue";

// On-demand panels and modal: their heavy deps (diff viewer, terminal/ghostty
// WASM, the full settings surface) are split into lazy chunks and only fetched
// when the panel is actually opened, instead of paying for them on first paint.
const SettingsModal = defineAsyncComponent(
  () => import("@/components/modals/SettingsView.vue"),
);
const AsyncTerminalPanel = defineAsyncComponent(
  () => import("@/components/panels/TerminalPanel.vue"),
);
const AsyncGitPanel = defineAsyncComponent(() => import("@/components/panels/GitPanel.vue"));
const AsyncFilesPanel = defineAsyncComponent(() => import("@/components/panels/FilesPanel.vue"));
const AsyncContextPanel = defineAsyncComponent(() => import("@/components/panels/ContextPanel.vue"));

const rightPanel = computed(() => ({
  git: AsyncGitPanel,
  files: AsyncFilesPanel,
  context: AsyncContextPanel,
})[ui.activeRightPanel]);
</script>

<template>
  <div class="app-shell">
    <IconButton class="app-shell__sidebar-toggle" label="Toggle left sidebar" :pressed="ui.panels.left.open"
      @click="ui.toggle('left')">
      <LayoutLeftIcon />
    </IconButton>

    <SplitPane mode="left" :open="ui.panels.left.open" :size="ui.panels.left.size"
      @update:size="ui.setSize('left', $event)">
      <template #sidebar>
        <SessionSidebar />
      </template>

      <template #default>
        <section class="workspace">
          <SessionHeader />

          <div class="workspace__body">
            <SplitPane mode="right" :open="ui.panels.right.open" :size="ui.panels.right.size" :min-size="200"
              @update:size="ui.setSize('right', $event)">
              <template #default>
                <SplitPane mode="bottom" :open="ui.panels.bottom.open" :size="ui.panels.bottom.size"
                  :maximized="ui.maximized.bottom" @update:size="ui.setSize('bottom', $event)"
                  @update:maximized="ui.setMaximized('bottom', $event)">
                  <template #default>
                    <RouterView />
                  </template>
                  <template #sidebar>
                    <AsyncTerminalPanel />
                  </template>
                </SplitPane>
              </template>

              <template #sidebar>
                <KeepAlive>
                  <component :is="rightPanel" :key="ui.activeRightPanel" />
                </KeepAlive>
              </template>
            </SplitPane>
          </div>
        </section>
      </template>
    </SplitPane>

    <Modal :show="ui.settingsOpen" @close="ui.settingsOpen = false">
      <template #body>
        <SettingsModal @close="ui.settingsOpen = false" />
      </template>
    </Modal>
  </div>
</template>

<style>
:root {
  --ui-text: #171717;
  --ui-text-strong: #242320;
  --ui-text-muted: #76746d;
  --ui-surface: #fff;
  --ui-surface-subtle: #fafaf7;
  --ui-surface-muted: #f7f6f2;
  --ui-surface-hover: #f5f4f0;
  --ui-surface-selected: #e5e1d9;
  --ui-border: #dedbd2;
  --ui-border-subtle: #e7e4dc;
  --ui-border-focus: #bcb8ae;
  --ui-primary: #35332f;
  --ui-primary-hover: #242320;
  --ui-extension-bg: #e8edf4;
  --ui-extension-fg: #455c79;
  --ui-skill-bg: #e8f0e7;
  --ui-skill-fg: #476548;
  --ui-prompt-bg: #f2eade;
  --ui-prompt-fg: #765a34;
  --ui-code-inline-bg: #eeece7;
  --ui-code-inline-fg: #4e4a43;
  --ui-table-header-bg: #f0eee8;
  --ui-table-stripe-bg: #faf9f6;
  --ui-error-bg: rgb(255 240 240 / 72%);
  --ui-error-border: #e8b5b5;
  --ui-error-fg: #6f2828;
  --ui-error-strong: #a83838;
  --ui-error-hover: rgb(168 56 56 / 12%);
  --ui-overlay: rgb(0 0 0 / 45%);
  --ui-focus: #3978d4;
  --ui-panel-active: #8a735b;
  --ui-shadow-raised: 0 8px 24px rgb(35 32 27 / 10%);
  --ui-shadow-control: 0 1px 2px rgb(36 33 28 / 18%);
  --ui-duration-fast: 120ms;
  --ui-duration-medium: 160ms;
  --ui-ease-standard: ease;
  --ui-ease-emphasized: cubic-bezier(0.2, 0.8, 0.2, 1);
}

:root[data-theme="dark"] {
  --ui-text: #e8e6e1;
  --ui-text-strong: #f5f3ee;
  --ui-text-muted: #aaa69f;
  --ui-surface: #1d1d1b;
  --ui-surface-subtle: #232321;
  --ui-surface-muted: #282825;
  --ui-surface-hover: #2d2d29;
  --ui-surface-selected: #383731;
  --ui-border: #3b3a36;
  --ui-border-subtle: #34332f;
  --ui-border-focus: #67645d;
  --ui-primary: #e6e2da;
  --ui-primary-hover: #f5f2ec;
  --ui-extension-bg: #252b31;
  --ui-extension-fg: #8996a3;
  --ui-skill-bg: #252e27;
  --ui-skill-fg: #879b88;
  --ui-prompt-bg: #302a23;
  --ui-prompt-fg: #a08d72;
  --ui-code-inline-bg: #292927;
  --ui-code-inline-fg: #b7b3ac;
  --ui-table-header-bg: #292927;
  --ui-table-stripe-bg: #222220;
  --ui-error-bg: #2b2223;
  --ui-error-border: #523638;
  --ui-error-fg: #d9a0a0;
  --ui-error-strong: #e0aaaa;
  --ui-error-hover: rgb(224 170 170 / 10%);
  --ui-overlay: rgb(0 0 0 / 62%);
  --ui-focus: #78a9ed;
  --ui-panel-active: #c4aa88;
  --ui-shadow-raised: 0 10px 28px rgb(0 0 0 / 32%);
  --ui-shadow-control: 0 1px 2px rgb(0 0 0 / 28%);
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  color: var(--ui-text);
  background: var(--ui-surface);
  font-family: var(--ui-font-sans);
  font-size: 14px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
  background: transparent;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

*::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.35);
  background-clip: padding-box;
}

button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

:root .provider-logo--image {
  transition: filter var(--ui-duration-medium) var(--ui-ease-standard);
}

:root[data-theme="dark"] .provider-logo--image {
  filter: invert(1) brightness(0.88);
}

@media (prefers-reduced-motion: reduce) {
  :root .provider-logo--image { transition: none; }
}

.app-shell {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Shared full-height empty state for the independent right-side panels. */
.right-panel__pane {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--ui-surface);
}
.app-shell__sidebar-toggle {
  position: absolute;
  top: 11px;
  left: 11px;
  z-index: 10;
}
.app-shell .app-shell__sidebar-toggle.is-pressed {
  color: inherit;
}

.workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.workspace__body {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}

/* Shared popover panel transition (model selector, thinking selector).
 * Panels are teleported to <body>, so these classes are global. */
.popover-enter-active,
.popover-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.popover-enter-from,
.popover-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* Shared edge treatment for scrollable content surfaces. */
.scroll-fade-bottom {
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 calc(100% - 26px), transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 calc(100% - 26px), transparent 100%);
}
</style>
