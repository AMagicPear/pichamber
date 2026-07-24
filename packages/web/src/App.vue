<script setup lang="ts">
import SplitPane from "@/components/SplitPane.vue";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
</script>

<template>
  <SplitPane mode="left">
    <template #default>
      <SplitPane mode="right">
        <template #default>
          <SplitPane mode="bottom">
            <template #default />
            <template #sidebar />
          </SplitPane>
        </template>
        <template #sidebar />
      </SplitPane>
    </template>
    <template #sidebar />
  </SplitPane>
  <div class="debug-controls">
    <button type="button" @click="ui.toggle('left')">切换左栏</button>
    <button type="button" @click="ui.toggle('bottom')">切换下栏</button>
    <button type="button" @click="ui.toggle('right')">切换右栏</button>
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
.debug-controls {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 10;
}
</style>
