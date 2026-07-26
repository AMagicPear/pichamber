<script setup lang="ts">
import FileListIcon from "@/assets/icons/FileList2.svg";
</script>

<template>
  <div class="context-panel__pane" role="tabpanel" aria-label="context">
    <div class="context-panel__empty">
      <FileListIcon />
      <p>Context</p>
      <span>Files added to the next message will appear here.</span>
    </div>
  </div>
</template>
