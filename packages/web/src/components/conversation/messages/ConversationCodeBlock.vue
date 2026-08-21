<script setup lang="ts">
import { createCodeStream } from "stream-diffs";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { activeTheme } from "@/stores/theme";

const props = defineProps<{
  node: {
    code?: string;
    language?: string;
  };
  /** markstream-vue passes `stream` to code_block overrides; false once the
   *  parent MarkdownRender is final, true while the model is still writing.
   *  stream-diffs is designed for the streaming→settled split: incremental
   *  `updateSnapshot` during streaming, a single `finalize` once stable. The
   *  previous version of this component re-mounted + re-finalized on every
   *  prop change, which made the highlight flicker on every token delta. */
  stream?: boolean;
}>();

const host = ref<HTMLElement>();
let controller: ReturnType<typeof createCodeStream> | undefined;
let mountedGeneration = 0;
/** Once we've upgraded to the File surface, stop pushing snapshots — the
 *  surface is locked in and any trailing code from late-arriving deltas
 *  would just race the finalize. */
let finalized = false;
let viewportObserver: IntersectionObserver | undefined;

/** Mount a fresh controller (language or theme changed, or first mount).
 *  Called at most once per generation; concurrent calls early-out via the
 *  generation guard so a mid-mount prop change doesn't double-mount. */
const mount = async () => {
  const gen = ++mountedGeneration;
  controller?.dispose();
  finalized = false;
  if (!host.value) return;
  const next = createCodeStream({
    fileName: `code.${props.node.language || "txt"}`,
    language: props.node.language || "plaintext",
    theme: activeTheme.value === "dark" ? "vitesse-dark" : "vitesse-light",
    lineNumbers: true,
  });
  controller = next;
  await next.mount(host.value);
  if (gen !== mountedGeneration || controller !== next) {
    next.dispose();
    return;
  }
  next.updateSnapshot(props.node.code || "");
};

/** 首次挂载时容器可能尚未布局（刷新后滚动恢复 / content-visibility 跳过），
 *  pierre 的虚拟化会按 0 高度渲染成空白。进入视口后若内容高度仍为 0，重挂一次。 */
const renderIfEmpty = () => {
  const el = host.value;
  if (!el) return;
  const child = el.firstElementChild;
  const height = child?.getBoundingClientRect().height ?? el.getBoundingClientRect().height;
  if (height <= 0) void mount();
};

onMounted(() => {
  void mount();
  viewportObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        viewportObserver?.disconnect();
        renderIfEmpty();
      }
    },
    { threshold: 0.01 },
  );
  viewportObserver.observe(host.value!);
});
onBeforeUnmount(() => {
  viewportObserver?.disconnect();
  controller?.dispose();
  controller = undefined;
});

/** Language / theme changes require a re-mount (stream-diffs locks these in
 *  on creation). Code changes just push a snapshot — incremental, no flicker. */
watch(
  () => [props.node.language, activeTheme.value],
  () => void mount(),
);

watch(
  () => props.node.code,
  (code) => {
    // Once finalized the surface is locked; ignore late deltas so we don't
    // race against the File view we just upgraded into.
    if (finalized) return;
    controller?.updateSnapshot(code || "");
  },
);

/** Markstream flips `stream` to false when the surrounding MarkdownRender
 *  becomes final. That's the moment to upgrade from the live-highlight
 *  pre tag to the interactive File surface (line numbers, collapse, copy).
 *  We only do this once per mount — finalize locks the surface. */
watch(
  () => props.stream === false,
  (isFinal) => {
    if (!isFinal || !controller || finalized) return;
    finalized = true;
    // disableFileHeader: pierre's File surface defaults to a filename header
    // (or "code.txt" when language is unknown). Code blocks shouldn't show
    // that — keep it suppressed.
    void controller.finalize({ view: "file", disableFileHeader: true });
  },
  { immediate: true },
);
</script>

<template>
  <div ref="host" class="conversation-code-block" />
</template>

<style scoped>
.conversation-code-block {
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 6px;
}
.conversation-code-block :deep(.stream-diffs-shell) {
  max-height: 36rem;
}
</style>
