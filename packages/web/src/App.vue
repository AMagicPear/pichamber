<script setup lang="ts">
import SplitPane from "@/components/SplitPane.vue";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
</script>

<template>
  <SplitPane mode="bottom">
    <template #default>
      <SplitPane mode="left">
        <template #default>
          <SplitPane mode="right">
            <template #default><div class="debug-fill debug-fill--main" /></template>
            <template #sidebar><div class="debug-fill debug-fill--right" /></template>
          </SplitPane>
        </template>
        <template #sidebar><div class="debug-fill debug-fill--left" /></template>
      </SplitPane>
    </template>
    <template #sidebar><div class="debug-fill debug-fill--bottom" /></template>
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
.debug-fill {
  width: 100%;
  height: 100%;
}
.debug-fill--main {
  background: #fef08a;
}
.debug-fill--left {
  background: #fca5a5;
}
.debug-fill--right {
  background: #93c5fd;
}
.debug-fill--bottom {
  background: #86efac;
}
.debug-controls {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 10;
}
</style>
