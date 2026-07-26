<script setup lang="ts">
import LayoutLeftIcon from "@/assets/icons/LayoutLeft.svg";
import IconButton from "@/components/IconButton.vue";
import SplitPane from "@/components/layout/SplitPane.vue";
import SettingsModal from "@/components/layout/SettingsModal.vue";
import SettingsView from "@/components/modals/SettingsView.vue";
import { saveUiState, ui } from "@/stores/ui";
import ContextPanel from "@/components/panels/ContextPanel.vue";
import SessionHeader from "@/components/panels/SessionHeader.vue";
import SessionSidebar from "@/components/panels/SessionSidebar.vue";
import TerminalPanel from "@/components/panels/TerminalPanel.vue";
import { workspace } from "./stores/workspace";
import ConversationPanel from "./components/panels/ConversationPanel.vue";
import { useRoute } from "vue-router";
import { watch } from "vue";

const route = useRoute();

watch(ui, () => {
  saveUiState(ui.panels, ui.maximized);
}, { deep: true });

watch(
  () => route.params.sessionId,
  (sessionId) => {
    workspace.sessionId = typeof sessionId === "string" ? sessionId : null;
  },
  { immediate: true },
);
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
                    <ConversationPanel />
                  </template>
                  <template #sidebar>
                    <TerminalPanel />
                  </template>
                </SplitPane>
              </template>

              <template #sidebar>
                <ContextPanel />
              </template>
            </SplitPane>
          </div>
        </section>
      </template>
    </SplitPane>

    <SettingsModal :show="ui.settingsOpen" @close="ui.settingsOpen = false">
      <template #body>
        <SettingsView @close="ui.settingsOpen = false" />
      </template>
    </SettingsModal>
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
  color: #171717;
  font-family:
    Inter,
    ui-sans-serif,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
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
</style>
