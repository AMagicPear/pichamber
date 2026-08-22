<script setup lang="ts">
import { computed } from "vue";
import MarkdownRender from "markstream-vue";

const props = defineProps<{
  /** Markdown source. */
  content: string;
  /** Pass-through to MarkdownRender; defaults to true (always-finalized).
   *  AssistantMessage passes its streaming state in via this prop. */
  final?: boolean;
}>();

const isFinal = computed(() => props.final ?? true);

/** While the model is still streaming, use the README-recommended chat
 *  "typewriter" mode (incremental batching with small slices) instead of
 *  the default virtual-window mode, which jumps content in large batches.
 *  Once final, fall back to the default virtual window for stable
 *  scrollback on long/committed content. `undefined` defers to the
 *  component default so finalized surfaces are untouched. */
const streaming = computed(() => !isFinal.value);
</script>

<template>
  <!-- Common chat-mode props are hardcoded; extra class and props fall
       through to the MarkdownRender root automatically. `viewport-priority`
       is left at its default (auto) so the renderer's viewport-aware
       scheduling stays enabled. During streaming, `max-live-nodes=0` plus
       small render batches give the smooth per-token "typing" cadence the
       README recommends for chats. -->
  <MarkdownRender
    class="markdown-chat"
    mode="chat"
    :content="content"
    :final="isFinal"
    :fade="false"
    :max-live-nodes="streaming ? 0 : undefined"
    :render-batch-size="streaming ? 16 : undefined"
    :render-batch-delay="streaming ? 8 : undefined"
  />
</template>
