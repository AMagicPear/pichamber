<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { AgentMessage, ModelDescriptor } from "@amagicpear/pichamber-shared";
import AssistantMessage from "./AssistantMessage.vue";
import CompactionSummaryMessage from "./CompactionSummaryMessage.vue";
import CustomSummaryMessage from "./CustomSummaryMessage.vue";
import { conversationToolDetail, type ConversationToolDetail } from "./conversationToolDetail";
import { messageImages, messageText, messageTimestampText, toolResultText } from "./messageContent";
import ToolResultMessage from "./ToolResultMessage.vue";
import UserMessage from "./UserMessage.vue";
import { workspace, type ConversationItem, type ConversationTool } from "@/stores/workspace";

const props = defineProps<{
  items: ConversationItem[];
  availableModels?: ModelDescriptor[];
  /** Render a local timestamp under each committed message. */
  showTimestamps?: boolean;
}>();

/** Forward per-message menu actions (fork/copy) up to the conversation panel.
 *  No logic here — the panel decides what to do. */
const emit = defineEmits<{ fork: []; copy: [text: string] }>();

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
let scrollFrame: number | undefined;
let viewportResizeTimer: ReturnType<typeof setTimeout> | undefined;

const scrollToBottom = () => {
  const el = scroller.value;
  if (!el) return;
  ignoreScrollTop = el.scrollHeight;
  el.scrollTop = el.scrollHeight;
};

const scheduleScrollToBottom = () => {
  if (scrollFrame !== undefined) return;
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = undefined;
    if (stickToBottom.value) scrollToBottom();
  });
};

const onViewportResize = () => {
  if (viewportResizeTimer !== undefined) clearTimeout(viewportResizeTimer);
  viewportResizeTimer = setTimeout(() => {
    viewportResizeTimer = undefined;
    scheduleScrollToBottom();
  }, 120);
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
  window.addEventListener("resize", onViewportResize);
  contentObserver = new ResizeObserver(() => {
    // Browser resizing changes every message's wrapping. Defer the one
    // anchor correction until resize settles instead of forcing layout on
    // every intermediate width.
    if (viewportResizeTimer !== undefined) return;
    const el = scroller.value;
    if (!el) return;
    // The browser can overscroll past the target; snap it back.
    if (el.scrollTop > el.scrollHeight - el.clientHeight) {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
    if (stickToBottom.value) scheduleScrollToBottom();
  });
  // Fires once immediately with the initial size, covering the first paint.
  contentObserver.observe(target);
});

onBeforeUnmount(() => {
  contentObserver?.disconnect();
  window.removeEventListener("resize", onViewportResize);
  if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  if (viewportResizeTimer !== undefined) clearTimeout(viewportResizeTimer);
});

watch(
  () => workspace.sessionId,
  () => {
    stickToBottom.value = true;
    escapedFromLock.value = false;
    scheduleScrollToBottom();
  },
  { immediate: true },
);

/** 工具条目渲染详情：提交后优先用权威 toolResult 消息内容，live 阶段用执行进度。
 *
 * Memoized by `tool`/`message` object reference: `conversation` is a
 * shallowRef rebuilt on every event (`buildConversationItems` / `replaceItem`),
 * so the list re-renders often and each tool row would otherwise re-parse its
 * output on every one of those renders. Committed tool items keep their
 * `tool`/`message` object identity across unrelated events, so the untouched
 * ones reuse this cache; a running tool (whose `tool` object is rebuilt on
 * each progress tick) still recomputes, which is exactly what it needs. */
const cachedToolDetail = new WeakMap<
  ConversationTool,
  { message: AgentMessage | undefined; detail: ConversationToolDetail }
>();

const computeToolDetail = (
  item: Extract<ConversationItem, { kind: "tool" }>,
): ConversationToolDetail => {
  const { tool, message } = item;
  const messageMeta = message as { toolName?: unknown; isError?: unknown } | undefined;
  // 提交后 message 是权威输出；live 阶段 tool.result 是 pi 的 `{content,
  // details}` 进度封套——取文本而非序列化整个 JSON，实时显示才能和提交后一致。
  const text = messageText(message);
  const output = message
    ? text || JSON.stringify(message, null, 2)
    : tool.result !== undefined
      ? toolResultText(tool.result)
      : "";
  // 读图片时 message 里有 image part；live 阶段没有 message，partialResult
  // 只是占位文字，所以图片只在提交后出现。
  const images = message ? messageImages(message) : [];
  // 计时只对正在运行的命令有意义：running 才标 running，startedAt
  // 由客户端在 tool_execution_start 写入，倒计时按它校准（重连/中途渲染也准）。
  return {
    ...conversationToolDetail({
      toolName: tool.toolName || (typeof messageMeta?.toolName === "string" ? messageMeta.toolName : ""),
      args: tool.args,
      output,
      isError: messageMeta?.isError === true || tool.isError === true,
      images,
    }),
    running: tool.running,
    startedAt: tool.startedAt,
  };
};

/** Memoized access into `computeToolDetail`: reuse the cached detail while
 *  the tool (and its authoritative message) object identities are unchanged. */
const toolDetail = (item: Extract<ConversationItem, { kind: "tool" }>): ConversationToolDetail => {
  const cached = cachedToolDetail.get(item.tool);
  if (cached && cached.message === item.message) return cached.detail;
  const detail = computeToolDetail(item);
  cachedToolDetail.set(item.tool, { message: item.message, detail });
  return detail;
};

/** Use the registry's friendly name everywhere a model id is displayed. */
const modelNameFor = (message: AgentMessage | undefined): string | undefined => {
  if (message?.role !== "assistant") return undefined;
  const { provider, model } = message;
  if (typeof model !== "string") return undefined;
  return (
    props.availableModels?.find((m) => m.provider === provider && m.id === model)?.name ??
    model
  );
};
</script>

<template>
  <div ref="scroller" class="conversation__messages scroll-fade-bottom" @scroll="onScroll" @wheel="onWheel">
    <div ref="content" class="conversation__content">
      <template v-for="item in items" :key="item.id">
        <UserMessage
          v-if="item.kind === 'message' && item.message.role === 'user'"
          :message="item.message"
          :timestamp-text="props.showTimestamps ? messageTimestampText(item.message) : undefined"
          @fork="emit('fork')"
          @copy="(text) => emit('copy', text)"
        />
        <AssistantMessage
          v-else-if="item.kind === 'message' && item.message.role === 'assistant'"
          :message="item.message"
          :final="!item.streaming"
          :model-name="modelNameFor(item.message)"
          :show-timestamp="!!props.showTimestamps"
          :timestamp-text="messageTimestampText(item.message)"
          @fork="emit('fork')"
          @copy="(text) => emit('copy', text)"
        />
        <CompactionSummaryMessage
          v-else-if="item.kind === 'message' && item.message.role === 'compactionSummary'"
          :message="item.message"
        />
        <CustomSummaryMessage
          v-else-if="item.kind === 'message' && (item.message.role === 'custom' || item.message.role === 'branchSummary')"
          :message="item.message"
        />
        <ToolResultMessage
          v-else-if="item.kind === 'tool'"
          :detail="toolDetail(item)"
        />
      </template>
    </div>
  </div>
</template>

<style>
/* Unscoped on purpose: these rules govern the spacing between sibling
 * articles rendered by different child components (AssistantMessage,
 * ToolResultMessage, UserMessage, CompactionSummaryMessage,
 * CustomSummaryMessage). Scoped CSS would attribute-match each child and
 * never see the others, breaking `+` sibling selectors. */
.conversation-message { width: 100%; max-width: var(--conversation-content-width); min-width: 0; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, var(--conversation-inline-gutter)); color: var(--ui-text); content-visibility: auto; contain-intrinsic-size: auto 96px; }
.conversation-message + .conversation-message { margin-top: 24px; }
.conversation-message--assistant + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--assistant,
.conversation-message--tool-result + .conversation-message--user { margin-top: 24px; }
.conversation-message--assistant-error + .conversation-message { margin-top: 24px; }
</style>

<style scoped>
.conversation__messages { flex: 1; align-self: stretch; width: 100%; min-width: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 24px max(var(--conversation-inline-gutter), calc((100% - var(--conversation-shell-width)) / 2)) 32px; }
</style>
