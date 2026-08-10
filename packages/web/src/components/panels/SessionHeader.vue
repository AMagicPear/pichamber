<script setup lang="ts">
import AiAgentIcon from "@/assets/icons/AiAgent.svg";
import GlobalIcon from "@/assets/icons/Global.svg";
import LayoutLeftIcon from "@/assets/icons/LayoutLeft.svg";
import LayoutRightIcon from "@/assets/icons/LayoutRight.svg";
import StackIcon from "@/assets/icons/Stack.svg";
import TerminalBoxIcon from "@/assets/icons/TerminalBox.svg";
import IconButton from "@/components/IconButton.vue";
import { ui } from "@/stores/ui";
import { workspace } from "@/stores/workspace";

</script>

<template>
  <header
    class="session-header"
    :class="{ 'is-left-collapsed': !ui.panels.left.open }"
  >
    <div class="session-header__leading">
      <div class="session-header__title">
          <h1 :title="workspace.sessionName ?? undefined">{{ workspace.sessionName }}</h1>
          <p :title="workspace.cwd ?? undefined">{{ workspace.cwd }}</p>
      </div>
    </div>

    <nav class="session-header__tools" aria-label="Session tools">
      <IconButton label="Projects"><StackIcon /></IconButton>
      <IconButton
        label="Toggle terminal panel"
        :pressed="ui.panels.bottom.open"
        @click="ui.toggle('bottom')"
      >
        <TerminalBoxIcon />
      </IconButton>
      <IconButton label="Web"><GlobalIcon /></IconButton>
      <IconButton
        label="Toggle right sidebar"
        :pressed="ui.panels.right.open"
        @click="ui.toggle('right')"
      >
        <LayoutRightIcon />
      </IconButton>
      <IconButton label="Account"><AiAgentIcon class="account-icon" /></IconButton>
    </nav>
  </header>
</template>

<style scoped>
.session-header {
  display: flex;
  flex: 0 0 50px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid #e8e6df;
}
.session-header.is-left-collapsed {
  padding-left: 48px;
}
.session-header__leading,
.session-header__tools {
  display: flex;
  align-items: center;
}
.session-header__leading {
  flex: 1 1 auto;
  min-width: 0;
  gap: 8px;
}
.session-header__title {
  min-width: 0;
}
.session-header h1,
.session-header p {
  margin: 0;
}
.session-header h1 {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-header p {
  overflow: hidden;
  color: #888;
  font-size: 11px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-header__tools {
  gap: 8px;
}
.account-icon {
  width: 22px;
  height: 22px;
}
</style>
