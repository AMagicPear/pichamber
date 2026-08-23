<script setup lang="ts">
// Renders a stream-diffs patch surface. The root .diff-view is the
// styled scroll box, so the parent doesn't need its own wrapper.
import { createDiffSurface } from "stream-diffs";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { activeTheme } from "@/stores/theme";

const props = defineProps<{
  /** Raw unified diff text (e.g. stdout from `git diff`). */
  patch: string;
  /** "unified" (default) keeps one column and suits narrow panes; "split"
      renders two columns side-by-side. */
  diffStyle?: "unified" | "split";
}>();

const host = ref<HTMLElement>();
let controller: ReturnType<typeof createDiffSurface> | undefined;

const render = async () => {
  controller?.dispose();
  if (!host.value) return;

  // Keep the diff pane on the same theme baseline as conversation code
  // blocks without sharing a renderer implementation with markstream.
  const next = createDiffSurface({
    kind: "patch",
    patch: props.patch,
    options: {
      theme: activeTheme.value === "dark" ? "vitesse-dark" : "vitesse-light",
      diffStyle: props.diffStyle ?? "unified",
      // Word-level highlight inside changed lines so small edits read
      // like prose instead of full-line blocks.
      lineDiffType: "word-alt",
      // Show every unchanged line for short per-file diffs; large
      // patches still collapse unchanged regions via Pierre's defaults.
      expandUnchanged: true,
    },
  });
  controller = next;
  await next.mount(host.value);
};

onMounted(() => void render());
onBeforeUnmount(() => controller?.dispose());
watch(() => [props.patch, props.diffStyle, activeTheme.value], () => void render());
</script>

<template>
  <div ref="host" class="diff-view" />
</template>

<style scoped>
.diff-view {
  display: flex;
  flex: 1 1 0;
  min-height: 120px;
  overflow: auto;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
}
/* Pierre's [data-code] is `display: grid; grid-template-columns:
   gutter 1fr`, so the content column and each line's + / - strip
   only stretch as far as the shell stretches. Force the shell to
   fill the box so the grid's 1fr column — and the line backgrounds
   inside it — actually reach the right edge when the sidebar is
   wide. */
.diff-view :deep(.stream-diffs-shell) {
  background: transparent;
  width: 100%;
  align-self: stretch;
}
</style>
