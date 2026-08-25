<script setup lang="ts">
import FolderIcon from "lucide-static/icons/folder.svg";
import FileTree from "@/components/panels/FileTree.vue";
import { workspace } from "@/stores/workspace";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <div class="right-panel__pane" role="tabpanel" aria-label="files">
    <FileTree v-if="workspace.cwd !== null" />
    <div v-else class="ui-empty-state">
      <FolderIcon />
      <p>{{ t('files.noWorkspace') }}</p>
      <span>{{ t('files.openWorkspace') }}</span>
    </div>
  </div>
</template>
