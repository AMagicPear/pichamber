<script setup lang="ts">
import IconButton from "@/components/ui/IconButton.vue";
import SplitPane from "@/components/shell/SplitPane.vue";
import Modal from "@/components/ui/Modal.vue";
import { ui } from "@/stores/ui";
import SessionHeader from "@/components/shell/SessionHeader.vue";
import SessionSidebar from "@/components/shell/SessionSidebar.vue";
import { RouterView, useRoute } from "vue-router";
import { computed, defineAsyncComponent, KeepAlive } from "vue";
import { MorphIcon } from "morphicons/vue";
import { lucideIcon } from "@/components/ui/morphIcons";

// On-demand panels and modal: their heavy deps (diff viewer, terminal/ghostty
// WASM, the full settings surface) are split into lazy chunks and only fetched
// when the panel is actually opened, instead of paying for them on first paint.
const SettingsModal = defineAsyncComponent(
  () => import("@/components/modals/settings/SettingsView.vue"),
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
const route = useRoute();
</script>

<template>
  <RouterView v-if="route.meta.standalone" />
  <div v-else class="app-shell">
    <IconButton class="app-shell__sidebar-toggle" :label="$t('app.toggleSidebar')" @click="ui.toggle('left')">
      <MorphIcon :icon="lucideIcon(ui.panels.left.open ? 'panel-left-close' : 'panel-left')" spring="snappy"/>
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
