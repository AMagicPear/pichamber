<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownRender from "markstream-vue";
import type {
  ConversationTranscriptMessage,
  LiveConversationState,
} from "@pichamber/shared";
import AssistantMessage from "./AssistantMessage.vue";
import ToolResultMessage from "./ToolResultMessage.vue";
import { conversationToolDetail } from "./conversationToolDetail";
import { messageText } from "./messageContent";
import { workspace } from "@/stores/workspace";

const props = defineProps<{
  entries: ConversationTranscriptMessage[];
  live: LiveConversationState;
}>();

/* ── Scroll anchoring (event-driven, following the StackBlitz
 * `use-stick-to-bottom` pattern used by chat apps) ─────────────
 *
 * - `scrollElement` + `contentElement`: a ResizeObserver watches the
 *   inner content wrapper; whenever content grows (streaming, async
 *   markdown) we scroll — but only while the user is still pinned.
 * - Escape lock: any upward user scroll (wheel or drag) immediately
 *   un-pins (`escapedFromLock`). It re-pins only after the user scrolls
 *   back down to within 70px of the bottom. This is what prevents the
 *   "magnet" pull when the user reads history.
 * - `ignoreScrollTop` distinguishes programmatic scrolls (set by us)
 *   from user scrolls so our own scrollTop writes don't un-pin.
 */
const scroller = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const stickToBottom = ref(true);
const escapedFromLock = ref(false);
let lastScrollTop = 0;
let ignoreScrollTop: number | undefined;
let contentObserver: ResizeObserver | null = null;

const scrollToBottom = () => {
  const el = scroller.value;
  if (!el) return;
  ignoreScrollTop = el.scrollHeight;
  el.scrollTop = el.scrollHeight;
};

const onScroll = () => {
  const el = scroller.value;
  if (!el) return;
  // Our own programmatic scroll — do not treat it as a user gesture.
  if (ignoreScrollTop !== undefined) {
    ignoreScrollTop = undefined;
    return;
  }
  const scrollTop = el.scrollTop;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 70;
  if (scrollTop < lastScrollTop) {
    escapedFromLock.value = true;
    stickToBottom.value = false;
  } else if (scrollTop > lastScrollTop) {
    escapedFromLock.value = false;
  }
  if (!escapedFromLock.value && nearBottom) stickToBottom.value = true;
  lastScrollTop = scrollTop;
};

const onWheel = (e: WheelEvent) => {
  // Wheel up always escapes, even when the browser cancels the scroll.
  if (e.deltaY < 0) {
    escapedFromLock.value = true;
    stickToBottom.value = false;
  }
};

onMounted(() => {
  const target = content.value;
  if (!target) return;
  contentObserver = new ResizeObserver(() => {
    const el = scroller.value;
    if (!el) return;
    // The browser can overscroll past the target; snap it back.
    if (el.scrollTop > el.scrollHeight - el.clientHeight) {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
    if (stickToBottom.value) scrollToBottom();
  });
  // Fires once immediately with the initial size, covering the first paint.
  contentObserver.observe(target);
});

onBeforeUnmount(() => contentObserver?.disconnect());

watch(
  () => workspace.sessionId,
  () => {
    stickToBottom.value = true;
    escapedFromLock.value = false;
    scrollToBottom();
  },
  { immediate: true },
);

const messageFor = (entry: ConversationTranscriptMessage) => entry.message;

type ToolCall = { id: string; name: string; arguments: unknown };

const toolCallsById = computed(() => {
  const calls = new Map<string, ToolCall>();
  for (const entry of props.entries) {
    const content = (messageFor(entry) as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object" || !("type" in part) || part.type !== "toolCall") continue;
      if (typeof part.id !== "string" || typeof part.name !== "string") continue;
      calls.set(part.id, { id: part.id, name: part.name, arguments: part.arguments });
    }
  }
  return calls;
});

const historyToolDetail = (entry: ConversationTranscriptMessage) => {
  const message = messageFor(entry);
  const meta = message as { toolCallId?: unknown; toolName?: unknown; isError?: boolean } | undefined;
  const toolCallId = typeof meta?.toolCallId === "string" ? meta.toolCallId : undefined;
  const call = toolCallId ? toolCallsById.value.get(toolCallId) : undefined;
  const toolName = typeof meta?.toolName === "string" ? meta.toolName : "";
  const output = messageText(message) || JSON.stringify(message, null, 2);
  return conversationToolDetail({
    toolName,
    args: call?.arguments,
    output,
    isError: meta?.isError === true,
    fallbackPreview: messageText(message),
  });
};

const liveToolDetails = computed(() =>
  props.live.toolExecutions.map((tool) => ({
    toolCallId: tool.toolCallId,
    detail: conversationToolDetail({
      toolName: tool.toolName,
      args: tool.args,
      output: JSON.stringify(tool.result === undefined ? tool.args : tool.result, null, 2),
      isError: tool.isError === true,
      fallbackPreview: JSON.stringify(tool.args),
    }),
  })),
);
</script>

<template>
  <div ref="scroller" class="conversation__messages" @scroll="onScroll" @wheel="onWheel">
    <div ref="content" class="conversation__content">
      <template v-for="entry in entries" :key="entry.id">
      <article v-if="messageFor(entry)?.role === 'user'" class="conversation-message conversation-message--user">
        <MarkdownRender
          class="conversation-message__user markdown-chat"
          mode="chat"
          :content="messageText(messageFor(entry))"
          :final="true"
          :fade="false"
        />
      </article>
      <AssistantMessage v-else-if="messageFor(entry)?.role === 'assistant'" :message="messageFor(entry)" :final="true" />
      <ToolResultMessage v-else-if="messageFor(entry)?.role === 'toolResult'" :detail="historyToolDetail(entry)" />
      <!-- Other roles (custom, compaction/branch summaries) render as a plain
           spacer so the transcript keeps its rhythm. -->
      <article v-else class="conversation-message" />
    </template>

    <article v-for="(message, index) in live.pendingUserMessages" :key="`live-user:${index}`" class="conversation-message conversation-message--user">
      <MarkdownRender
        class="conversation-message__user markdown-chat"
        mode="chat"
        :content="messageText(message)"
        :final="true"
        :fade="false"
      />
    </article>
      <AssistantMessage v-if="live.streamingMessage" :message="live.streamingMessage" :final="false" />
      <ToolResultMessage v-for="tool in liveToolDetails" :key="tool.toolCallId" :detail="tool.detail" />
    </div>
  </div>
</template>

<style scoped>
.conversation__messages { flex: 1; align-self: stretch; width: 100%; min-width: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 24px max(var(--conversation-inline-gutter), calc((100% - var(--conversation-shell-width)) / 2)) 32px; }
/* Virtual rendering via the browser: out-of-view messages skip layout &
   paint but keep their size (contain-intrinsic-size is the estimate until
   first paint), so very long histories scroll smoothly and resizing the
   pane doesn't relayout everything. Cheap, native, no height bookkeeping;
   expanded tool details survive remounts, which is a free bonus. */
.conversation-message { width: 100%; max-width: var(--conversation-content-width); min-width: 0; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, var(--conversation-inline-gutter)); color: #292827; content-visibility: auto; contain-intrinsic-size: auto 96px; }
.conversation-message + .conversation-message { margin-top: 28px; }
.conversation-message--assistant + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--assistant, .conversation-message--tool-result + .conversation-message--user { margin-top: 28px; }
.conversation-message--assistant-error + .conversation-message { margin-top: 28px; }
.conversation-message__user { width: fit-content; max-width: 85%; margin: 0 0 0 auto; padding: 12px 20px; border: 1px solid #ece9e0; border-radius: 12px 12px 4px; background: #f7f6f2; }

/* Error variants: red accent on the message block so failed turns read at
 * a glance instead of looking like an empty successful bubble. The author
 * header and text colors live in AssistantMessage.vue. */
.conversation-message--assistant-error {
  padding: 14px 16px;
  border: 1px solid #f4c2c2;
  border-radius: 10px;
  background: rgb(255 240 240 / 60%);
}
.conversation-message--tool-error :deep(.conversation-detail__label) {
  color: #a83838;
}
</style>
