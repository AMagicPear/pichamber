<script setup lang="ts">
// Renders a file's contents as a code view — line numbers, syntax
// highlighting, scroll box. Used for `read` tool results so file content
// renders like a real file instead of plain text. Same engine (pierre /
// Monaco) and theme as DiffView, so both surfaces sit on the same visual
// baseline inside the conversation.
import { createDiffSurface } from "stream-diffs";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { activeTheme } from "@/stores/theme";

const props = defineProps<{
  /** File contents. */
  content: string;
  /** File name for language detection (basename or relative path). */
  fileName?: string;
}>();

const host = ref<HTMLElement>();
let surface: ReturnType<typeof createDiffSurface> | undefined;

const render = async () => {
  surface?.dispose();
  if (!host.value) return;
  const next = createDiffSurface({
    kind: "file",
    file: { name: props.fileName ?? "file.txt", contents: props.content, lang: undefined },
    options: {
      theme: activeTheme.value === "dark" ? "vitesse-dark" : "vitesse-light",
    },
  });
  surface = next;
  await next.mount(host.value);
};

onMounted(() => void render());
onBeforeUnmount(() => surface?.dispose());
watch(() => [props.content, activeTheme.value], () => void render());
</script>

<template>
  <div ref="host" class="code-view" />
</template>

<style scoped>
.code-view {
  display: flex;
  flex: 1 1 0;
  min-height: 120px;
  max-width: 100%;
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
}
.code-view :deep(.stream-diffs-shell) {
  background: transparent;
  width: 100%;
  align-self: stretch;
}
</style>
