<script setup lang="ts">
import SplitPane from "@/components/SplitPane.vue";
import ContextPanel from "@/components/workspace/ContextPanel.vue";
import ConversationPanel from "@/components/workspace/ConversationPanel.vue";
import SessionHeader from "@/components/workspace/SessionHeader.vue";
import SessionSidebar from "@/components/workspace/SessionSidebar.vue";
import TerminalPanel from "@/components/workspace/TerminalPanel.vue";
</script>

<template>
  <SplitPane mode="left" :initial-size="280">
    <template #sidebar>
      <SessionSidebar />
    </template>

    <template #default>
      <section class="workspace">
        <SessionHeader />

        <div class="workspace__body">
          <SplitPane mode="right" :initial-size="356">
            <template #default>
              <SplitPane mode="bottom" :initial-size="225">
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
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
button {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
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
