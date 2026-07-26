<script setup lang="ts">
import AiAgentIcon from "@/assets/icons/AiAgent.svg";
import GlobalIcon from "@/assets/icons/Global.svg";
import LayoutLeftIcon from "@/assets/icons/LayoutLeft.svg";
import LayoutRightIcon from "@/assets/icons/LayoutRight.svg";
import StackIcon from "@/assets/icons/Stack.svg";
import TerminalBoxIcon from "@/assets/icons/TerminalBox.svg";
import IconButton from "@/components/IconButton.vue";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
</script>

<template>
  <header
    class="session-header"
    :class="{ 'is-left-collapsed': !ui.panels.left.open }"
  >
    <div class="session-header__leading">
      <div class="session-header__title">
        <h1>New session</h1>
        <p>amagicpear</p>
      </div>
    </div>

    <nav class="session-header__tools" aria-label="Session tools">
      <IconButton label="Appearance"><LayoutLeftIcon /></IconButton>
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
  min-width: 0;
  gap: 8px;
}
.session-header h1,
.session-header p {
  margin: 0;
}
.session-header h1 {
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
}
.session-header p {
  color: #888;
  font-size: 11px;
  line-height: 14px;
}
.session-header__tools {
  gap: 8px;
}
.account-icon {
  width: 22px;
  height: 22px;
}
</style>
