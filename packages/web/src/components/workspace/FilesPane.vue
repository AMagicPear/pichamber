<script setup lang="ts">
import FolderIcon from "@/assets/icons/Folder.svg";
import FileTree from "@/components/workspace/FileTree.vue";
import { workspace } from "@/stores/workspace";
</script>

<template>
  <div class="context-panel__pane" role="tabpanel" aria-label="files">
    <FileTree v-if="workspace.cwd !== null" />
    <div v-else class="context-panel__empty">
      <FolderIcon />
      <p>No workspace selected</p>
      <span>Open a workspace to browse its files.</span>
    </div>
  </div>
</template>
