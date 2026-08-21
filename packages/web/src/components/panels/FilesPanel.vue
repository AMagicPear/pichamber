<script setup lang="ts">
import FolderIcon from "@/assets/icons/Folder.svg";
import FileTree from "@/components/panels/FileTree.vue";
import { workspace } from "@/stores/workspace";
</script>

<template>
  <div class="right-panel__pane" role="tabpanel" aria-label="files">
    <FileTree v-if="workspace.cwd !== null" />
    <div v-else class="ui-empty-state">
      <FolderIcon />
      <p>No workspace selected</p>
      <span>Open a workspace to browse its files.</span>
    </div>
  </div>
</template>
