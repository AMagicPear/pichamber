<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownRender from "markstream-vue";
import type { LiveItem } from "@pichamber/shared";
import AssistantMessage from "./AssistantMessage.vue";
import ToolResultMessage from "./ToolResultMessage.vue";
import { conversationToolDetail, type ConversationToolDetail } from "./conversationToolDetail";
import { messageImages, messageText } from "./messageContent";
import { workspace } from "@/stores/workspace";

const props = defineProps<{
  items: LiveItem[];
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

/** 工具条目渲染详情：提交后优先用权威 toolResult 消息内容，live 阶段用执行进度。 */
const toolDetail = (item: Extract<LiveItem, { kind: "tool" }>): ConversationToolDetail => {
  const { tool, message } = item;
  const messageMeta = message as { toolName?: unknown; isError?: unknown } | undefined;
  const output = message
    ? messageText(message) || JSON.stringify(message, null, 2)
    : JSON.stringify(tool.result === undefined ? tool.args : tool.result, null, 2);
  // 读图片时 message 里有 image part；live 阶段没有 message，partialResult
  // 只是占位文字，所以图片只在提交后出现。
  const images = message ? messageImages(message) : [];
  return conversationToolDetail({
    toolName: tool.toolName || (typeof messageMeta?.toolName === "string" ? messageMeta.toolName : ""),
    args: tool.args,
    output,
    isError: messageMeta?.isError === true || tool.isError === true,
    fallbackPreview: messageText(message) || JSON.stringify(tool.args),
    images,
  });
};
</script>

<template>
  <div ref="scroller" class="conversation__messages scroll-fade-bottom" @scroll="onScroll" @wheel="onWheel">
    <div ref="content" class="conversation__content">
      <template v-for="item in items" :key="item.id">
        <article v-if="item.kind === 'user'" class="conversation-message conversation-message--user">
          <MarkdownRender
            class="conversation-message__user markdown-chat"
            mode="chat"
            :content="messageText(item.message)"
            :final="true"
            :fade="false"
            :viewport-priority="false"
          />
          <div v-if="messageImages(item.message).length > 0" class="conversation-message__images">
            <img
              v-for="(img, i) in messageImages(item.message)"
              :key="i"
              :src="`data:${img.mimeType};base64,${img.data}`"
              alt="Attached image"
            />
          </div>
        </article>
        <AssistantMessage v-else-if="item.kind === 'assistant'" :message="item.message" :final="item.phase === 'committed'" />
        <ToolResultMessage v-else-if="item.kind === 'tool'" :detail="toolDetail(item)" />
      </template>
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
.conversation-message__user { width: fit-content; max-width: 85%; margin: 0 0 0 auto; padding: 8px 14px; border: 1px solid #ece9e0; border-radius: 12px 12px 4px; background: #f7f6f2; }

/* Attached images inside the user bubble: thumbnails capped to the bubble
   width, stacked vertically with the text above. */
.conversation-message__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.conversation-message__images img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  border-radius: 8px;
  object-fit: contain;
}

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
