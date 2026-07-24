<script setup lang="ts">
import AddIcon from "@/assets/icons/Add.svg";
import CloseIcon from "@/assets/icons/Close.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
import PanelToggleButton from "@/components/PanelToggleButton.vue";
import IconButton from "@/components/IconButton.vue";
</script>

<template>
  <section class="terminal">
    <header>
      <div class="terminal__tab"><TerminalIcon /><span>Terminal</span></div>
      <div class="terminal__actions">
        <IconButton size="compact" label="New terminal"><AddIcon /></IconButton>
        <IconButton size="compact" label="Maximize terminal"><FullscreenIcon /></IconButton>
        <PanelToggleButton size="compact" panel="bottom" label="Close terminal panel">
          <CloseIcon />
        </PanelToggleButton>
      </div>
    </header>
  </section>
</template>

<style scoped>
.terminal {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.terminal header {
  display: flex;
  height: 34px;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid #dedbd2;
  font-size: 14px;
}
.terminal__tab {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 7px;
  border-bottom: 2px solid #b65323;
}
.terminal__tab svg {
  width: 16px;
  height: 16px;
}
.terminal__actions {
  display: flex;
  align-items: center;
  gap: 3px;
}
</style>
