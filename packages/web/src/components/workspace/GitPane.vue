<script setup lang="ts">
import GitBranchIcon from "@/assets/icons/GitBranch.svg";
</script>

<template>
  <div class="context-panel__pane" role="tabpanel" aria-label="git">
    <div class="context-panel__empty">
      <GitBranchIcon />
      <p>This directory is not a Git repository</p>
      <span>Initialize Git in this directory or open a repository.</span>
    </div>
  </div>
</template>
