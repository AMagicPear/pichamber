<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MarkdownRender from "markstream-vue";
import type { AgentMessage, LiveItem, ModelDescriptor } from "@pichamber/shared";
import AssistantMessage from "./AssistantMessage.vue";
import ToolResultMessage from "./ToolResultMessage.vue";
import { conversationToolDetail, type ConversationToolDetail } from "./conversationToolDetail";
import { messageImages, messageText, toolResultText } from "./messageContent";
import { parseSkillBlock } from "./skillBlock";
import SkillBlockChip from "./SkillBlockChip.vue";
import { modelDisplayName } from "./modelDisplay";
import { workspace } from "@/stores/workspace";

const props = defineProps<{
  items: LiveItem[];
  availableModels?: ModelDescriptor[];
  /** Render a local timestamp under each committed message. */
  showTimestamps?: boolean;
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

/** 工具条目渲染详情：提交后优先用权威 toolResult 消息内容，live 阶段用执行进度。 */
const toolDetail = (item: Extract<LiveItem, { kind: "tool" }>): ConversationToolDetail => {
  const { tool, message } = item;
  const messageMeta = message as { toolName?: unknown; isError?: unknown } | undefined;
  // 提交后 message 是权威输出；live 阶段 tool.result 是 pi 的 `{content,
  // details}` 进度封套——取文本而非序列化整个 JSON，实时显示才能和提交后一致。
  const output = message
    ? messageText(message) || JSON.stringify(message, null, 2)
    : tool.result !== undefined
      ? toolResultText(tool.result)
      : "";
  // 读图片时 message 里有 image part；live 阶段没有 message，partialResult
  // 只是占位文字，所以图片只在提交后出现。
  const images = message ? messageImages(message) : [];
  // 计时只对正在运行的命令有意义：live + running 才标 running，startedAt
  // 由服务端在 tool_execution_start 写入，倒计时按它校准（重连/中途渲染也准）。
  return {
    ...conversationToolDetail({
      toolName: tool.toolName || (typeof messageMeta?.toolName === "string" ? messageMeta.toolName : ""),
      args: tool.args,
      output,
      isError: messageMeta?.isError === true || tool.isError === true,
      fallbackPreview: messageText(message) || JSON.stringify(tool.args),
      images,
    }),
    running: item.phase === "live" && tool.running,
    startedAt: tool.startedAt,
  };
};

const modelNameFor = (message: Extract<LiveItem, { kind: "assistant" }>["message"] | undefined): string | undefined => {
  if (message?.role !== "assistant") return undefined;
  const model = message as { provider?: unknown; model?: unknown };
  return modelDisplayName(props.availableModels, model.provider, model.model);
};

/** Returns the parsed skill block when the user message is the canonical
 *  shape pi produces from `/skill:name` expansion, otherwise null.
 *  pi appends the skill's body wrapped in `<skill ...>...</skill>`; without
 *  this check the markdown renderer treats it as malformed HTML and clips
 *  the message on the inner `<table>`/`<tr>` tags. */
type SkillBlockShape = { name: string; location: string; userMessage?: string };
const skillBlockFor = (message: Extract<LiveItem, { message?: unknown }>["message"]): SkillBlockShape | null => {
  const text = messageText(message);
  if (!text) return null;
  // Avoid the full regex probe on every keystroke for every message; the
  // shape always starts with the literal "<skill ". message.content is also
  // validated as a string above, so a substring check is enough.
  if (!text.startsWith("<skill ")) return null;
  const parsed = parseSkillBlock(text);
  if (!parsed) return null;
  return { name: parsed.name, location: parsed.location, userMessage: parsed.userMessage };
};

/** Pre-compute skill-block parsing once per user message so the template
 *  doesn't run the regex multiple times for the same item. */
const userSkillBlocks = computed(() => {
  const map = new Map<string, SkillBlockShape | null>();
  for (const item of props.items) {
    if (item.kind === "user" && item.message) {
      map.set(item.id, skillBlockFor(item.message));
    }
  }
  return map;
});

/** Cheap, locale-aware timestamp string reused by both user and assistant
 *  rows. Pulls the actual server-assigned `timestamp` (ms epoch) off the
 *  message — every pi message type carries one — so the displayed time
 *  matches when the message was committed, not when the timestamp row
 *  was first rendered. Returns undefined when the message is empty (a
 *  rare "draft" placeholder) so the template can omit the footer. */
const formatLocalTimestamp = (message: AgentMessage | undefined): string | undefined => {
  if (!message) return undefined;
  const ts = (message as { timestamp?: unknown }).timestamp;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return undefined;
  return new Date(ts).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
};
</script>

<template>
  <div ref="scroller" class="conversation__messages scroll-fade-bottom" @scroll="onScroll" @wheel="onWheel">
    <div ref="content" class="conversation__content">
      <template v-for="item in items" :key="item.id">
        <article v-if="item.kind === 'user'" v-memo="[item]" class="conversation-message conversation-message--user">
          <div
            v-for="(img, i) in messageImages(item.message)"
            :key="`image:${i}`"
            class="conversation-message__image"
          >
            <img
              :src="`data:${img.mimeType};base64,${img.data}`"
              alt="Attached image"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div v-if="userSkillBlocks.get(item.id) || messageText(item.message)" class="conversation-message__user">
            <!-- When the user message starts with a pi-expanded skill block,
                 collapse the body to a chip so the markdown renderer doesn't
                 see an HTML-shaped blob (its sanitizer would clip on the
                 inner `<table>` tags and the user ends up staring at raw
                 XML). Any trailing text the user appended after the
                 `/skill:name` command is rendered normally. -->
            <template v-if="userSkillBlocks.get(item.id)">
              <SkillBlockChip
                :name="userSkillBlocks.get(item.id)!.name"
                :location="userSkillBlocks.get(item.id)!.location"
              />
              <MarkdownRender
                v-if="userSkillBlocks.get(item.id)!.userMessage"
                class="markdown-chat"
                mode="chat"
                :content="userSkillBlocks.get(item.id)!.userMessage!"
                :final="true"
                :fade="false"
                :viewport-priority="false"
              />
            </template>
            <MarkdownRender
              v-else-if="messageText(item.message)"
              class="markdown-chat"
              mode="chat"
              :content="messageText(item.message)"
              :final="true"
              :fade="false"
              :viewport-priority="false"
            />
          </div>
          <p v-if="props.showTimestamps" class="conversation-message__timestamp">{{ formatLocalTimestamp(item.message) }}</p>
        </article>
        <AssistantMessage
          v-else-if="item.kind === 'assistant' && item.message"
          :message="item.message"
          :final="item.phase === 'committed'"
          :model-name="modelNameFor(item.message)"
          :show-timestamp="!!props.showTimestamps"
          :timestamp-text="formatLocalTimestamp(item.message)"
        />
        <ToolResultMessage v-else-if="item.kind === 'tool'" v-memo="[item]" :detail="toolDetail(item)" />
        <article v-else-if="item.kind === 'compaction'" v-memo="[item]" class="conversation-message conversation-message--compaction">
          <div class="compaction-summary">
            <div class="compaction-summary__header">
              <span class="compaction-summary__label">[compaction]</span>
              <span class="compaction-summary__meta">Compacted from {{ item.tokensBefore.toLocaleString() }} tokens</span>
            </div>
            <MarkdownRender
              class="markdown-chat"
              mode="chat"
              :content="item.summary"
              :final="true"
              :fade="false"
              :viewport-priority="false"
            />
          </div>
        </article>
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
.conversation-message { width: 100%; max-width: var(--conversation-content-width); min-width: 0; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, var(--conversation-inline-gutter)); color: var(--ui-text); content-visibility: auto; contain-intrinsic-size: auto 96px; }
.conversation-message + .conversation-message { margin-top: 24px; }
.conversation-message--assistant + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--tool-result { margin-top: 12px; }
.conversation-message--tool-result + .conversation-message--assistant, .conversation-message--tool-result + .conversation-message--user { margin-top: 24px; }
.conversation-message--assistant-error + .conversation-message { margin-top: 24px; }

/* User-side timestamp footer: tucked to the right edge under the
 * right-anchored bubble so it reads as a quiet metadata note, not
 * content. (Assistant messages render their time inline in the author
 * header row instead — see AssistantMessage.vue — because a wider body
 * has no clean footer edge to follow.) */
.conversation-message__timestamp {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.conversation-message--user { display: flex; flex-direction: column; align-items: flex-end; }
.conversation-message--user .conversation-message__timestamp {
  text-align: right;
}

/* Compaction summary block: a quiet inset card between messages, mirroring
   the TUI's CompactionSummaryMessage (same surface as custom messages). */
.conversation-message--compaction { content-visibility: auto; contain-intrinsic-size: auto 120px; }
.compaction-summary {
  padding: 12px 16px;
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-secondary);
  font-size: 14px;
}
.compaction-summary__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.compaction-summary__label { font-weight: 700; color: var(--ui-text); }
.compaction-summary__meta { color: var(--ui-text-tertiary); font-size: 12px; }
.conversation-message__user { display: grid; box-sizing: border-box; width: fit-content; max-width: 85%; margin: 0 0 0 auto; padding: 8px 14px; border: 1px solid var(--ui-border-subtle); border-radius: 12px 12px 4px; background: var(--ui-surface-muted); }

/* Force the bubble to actually honor its 85% cap when the content
   carries long unbroken strings (paths / URLs in mixed CJK messages).
   Grid items default to min-width: auto, which lets a long line push the
   bubble past the cap; resetting to 0 lets `max-width` take effect and
   hands the wrap rules in `markdown-chat` down to the markdown node. */
.conversation-message__user { min-width: 0; max-width: 85%; }
.conversation-message__user > * { min-width: 0; max-width: 100%; }

/* Each attachment is its own image message, outside the text bubble. */
.conversation-message__image {
  display: flex;
  justify-content: flex-end;
  width: 85%;
  max-width: 420px;
  margin: 0 0 8px auto;
}
.conversation-message__image img {
  display: block;
  width: auto;
  max-width: 100%;
  max-height: 320px;
  border-radius: 8px;
  object-fit: contain;
  animation: user-image-enter 180ms var(--ui-ease-emphasized) both;
}
@keyframes user-image-enter {
  from { opacity: 0; transform: translateY(3px); }
}

@media (prefers-reduced-motion: reduce) {
  .conversation-message__image img { animation: none; }
}

/* Error variants: red accent on the message block so failed turns read at
 * a glance instead of looking like an empty successful bubble. The author
 * header and text colors live in AssistantMessage.vue. */
.conversation-message--assistant-error {
  padding: 14px 16px;
  border: 1px solid var(--ui-error-border);
  border-radius: 10px;
  background: var(--ui-error-bg);
}
.conversation-message--tool-error :deep(.conversation-detail__label) {
  color: var(--ui-error-strong);
}
</style>
