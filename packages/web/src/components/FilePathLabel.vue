<script setup lang="ts">
/**
 * Renders a workspace path with the basename emphasised and the directory
 * tail muted — the shared vocabulary for `read` / `edit` / `write` tool
 * results in the conversation and the git panel's changed-file rows.
 *
 * The file-type icon (catppuccin) is derived from the basename *inside*
 * this component, so every surface that mentions a file gets the same
 * "icon → muted dirs → bright basename" layout without duplicating logic.
 */
import { computed } from "vue";
import { lastSeparatorIndex } from "@amagicpear/pichamber-shared";
import { getEntryIcon } from "@/components/workspace/fileIcon";

const props = withDefaults(
  defineProps<{
    /** Absolute or workspace-relative path. Split on the last separator. */
    path?: string;
    /** Hide the muted directory prefix (keeps only the basename). */
    showPrefix?: boolean;
  }>(),
  { showPrefix: true },
);

const parts = computed(() => {
  if (!props.path) return null;
  // Treat both `/` and `\` as separators so the basename lights up on
  // Windows paths (e.g. `C:\Users\foo\file.ts` → `file.ts`).
  const separator = lastSeparatorIndex(props.path);
  if (separator < 0) return { prefix: "", tail: props.path };
  return { prefix: props.path.slice(0, separator + 1), tail: props.path.slice(separator + 1) };
});

const icon = computed(() => (parts.value ? getEntryIcon(parts.value.tail, false, false) : undefined));
</script>

<template>
  <span class="file-path">
    <svg v-if="icon" class="file-path__icon" aria-hidden="true"><use :href="icon" /></svg>
    <template v-if="parts">
      <span v-if="showPrefix" class="file-path__prefix">{{ parts.prefix }}</span>
      <span class="file-path__tail" :title="props.path">{{ parts.tail }}</span>
    </template>
  </span>
</template>

<style scoped>
.file-path {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  font-size: inherit;
  line-height: inherit;
}
.file-path__icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  object-fit: contain;
  margin-right: 6px;
}
.file-path__prefix {
  min-width: 0;
  overflow: hidden;
  color: #76746d;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-path__tail {
  flex: none;
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>