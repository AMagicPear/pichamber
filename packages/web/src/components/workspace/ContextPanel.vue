<script setup lang="ts">
import FileListIcon from "@/assets/icons/FileList2.svg";
import FolderIcon from "@/assets/icons/Folder.svg";
import GitBranchIcon from "@/assets/icons/GitBranch.svg";
</script>

<template>
  <aside class="context-panel">
    <nav class="context-panel__tabs">
      <button type="button" class="is-active"><GitBranchIcon /><span>git</span></button>
      <button type="button"><FolderIcon /><span>files</span></button>
      <button type="button"><FileListIcon /><span>context</span></button>
    </nav>
    <div class="context-panel__empty">
      <GitBranchIcon />
      <p>This directory is not a Git repository</p>
      <span>Initialize Git in this directory or open a repository.</span>
    </div>
  </aside>
</template>

<style scoped>
.context-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.context-panel__tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 10px;
  border-bottom: 1px solid #eeeae1;
  color: #666;
  font-size: 14px;
}
.context-panel__tabs button {
  display: inline-flex;
  flex: 1;
  height: 30px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  font-weight: 600;
}
.context-panel__tabs button svg {
  width: 16px;
  height: 16px;
}
.context-panel__tabs .is-active {
  border: 1px solid #dedbd2;
  color: #222;
}
.context-panel__empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
}
.context-panel__empty > svg {
  width: 24px;
  height: 24px;
  margin-bottom: 14px;
  color: #777;
}
.context-panel__empty p {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}
.context-panel__empty span {
  color: #777;
  font-size: 12px;
}
</style>
