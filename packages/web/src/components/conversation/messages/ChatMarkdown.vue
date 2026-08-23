<script setup lang="ts">
import { computed } from "vue";
import MarkdownRender from "markstream-vue";
import { activeTheme } from "@/stores/theme";

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

/** Keep code-block theme selection in the official CodeBlockNode path. The
 * renderer owns the streaming <pre> -> final File transition, so this only
 * supplies stable presentation inputs and never remounts a code block. */
const isDark = computed(() => activeTheme.value === "dark");
const codeBlockProps = {
  theme: { light: "vitesse-light", dark: "vitesse-dark" },
};
const codeBlockOptions = {
  fontFamily: "var(--ui-font-mono)",
  fontSize: 12,
  lineHeight: 18,
  maxHeight: 576,
};
</script>

<template>
  <!-- Keep the renderer in chat/incremental mode. Code blocks are left on
       markstream-vue's built-in CodeBlockNode so it can keep the streaming
       fallback visible and atomically promote it once the final surface is
       ready. -->
  <MarkdownRender
    class="markdown-chat"
    mode="chat"
    :content="content"
    :final="isFinal"
    :fade="false"
    smooth-streaming="auto"
    :is-dark="isDark"
    :code-block-props="codeBlockProps"
    :code-block-options="codeBlockOptions"
    :max-live-nodes="streaming ? 0 : undefined"
    :render-batch-size="streaming ? 16 : undefined"
    :render-batch-delay="streaming ? 8 : undefined"
  />
</template>
