<script setup lang="ts">
import MarkdownRender from "markstream-vue";

defineProps<{
  /** Markdown source. */
  content: string;
  /** Pass-through to MarkdownRender; defaults to true (always-finalized).
   *  AssistantMessage passes its streaming state in via this prop. */
  final?: boolean;
}>();
</script>

<template>
  <!-- Common chat-mode props are hardcoded; extra class and props
       (e.g. :code-block-monaco-options from AssistantMessage) fall
       through to the MarkdownRender root automatically. -->
  <MarkdownRender
    class="markdown-chat"
    mode="chat"
    :content="content"
    :final="final ?? true"
    :fade="false"
    :viewport-priority="false"
  />
</template>
