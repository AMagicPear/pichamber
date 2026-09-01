<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { MorphIcon } from "morphicons/vue";
import type { IconNode } from "morphicons";
import FilePathLabel from "@/components/ui/FilePathLabel.vue";
import { lucideIcon, type LucideIconName } from "@/components/ui/morphIcons";
import { type ToolBody } from "./toolBody";
import ToolBodyView from "./ToolBodyView";

const props = defineProps<{
  /** Lucide icon name (e.g. `"square-terminal"`); resolved via
   *  `useLucideIcon` and morphed to a chevron on hover/expand. */
  icon?: LucideIconName;
  /** i18n key for the label, resolved reactively via `t(labelKey, labelParams)`. */
  labelKey: string;
  /** Interpolation params for `labelKey` (e.g. `tools.custom`'s `{name}`). */
  labelParams?: Record<string, unknown>;
  /** Render the label with a "failed" suffix (tool results). */
  isError?: boolean;
  preview?: string;
  /** Full file path — rendered filename-first via FilePathLabel. */
  path?: string;
  /** 显式 timeout（秒），bash 行尾的小胶囊。 */
  timeout?: number;
  /** 命令是否正在运行：live 条目显示已运行秒数；历史重建不显示耗时。 */
  running?: boolean;
  /** 工具开始执行的时刻（ms）；倒计时按它校准，不随渲染时机漂移。 */
  startedAt?: number;
  /** Body shape — the dispatcher picks a renderer from `body.kind`. */
  body: ToolBody;
  /** Whether Markdown content is complete; the renderer uses this to choose
   * the appropriate streaming or completed Markdown behavior. */
  final?: boolean;
  /** Auto-expand while true (caller flips it when streaming starts) and
   *  auto-collapse when it flips false (streaming segment ended). Manual
   *  toggles between the flips are respected. */
  autoExpand?: boolean;
  /** Hide the plain preview line while expanded. Summary-type previews
   *  (Thinking: same text as the body) are redundant when open; header-type
   *  previews (bash command / ls path) stay visible. */
  hidePreviewOnExpand?: boolean;
}>();

const { t } = useI18n();

/** Tool label resolved from its i18n key; failed calls append "failed". */
const labelText = computed(() => {
  const name = props.labelParams ? t(props.labelKey, props.labelParams) : t(props.labelKey);
  return props.isError ? t("tools.failed", { name }) : name;
});

// Start collapsed. Callers opt into the streaming lifecycle through
// `autoExpand`; its value changes open the detail at stream start and close it
// when the stream ends, while manual toggles remain respected in between.
/** Lucide chevron icons, sourced from `lucide-static` (the same SVG
 *  files `lucide-vue-next` exports). Single subpath each, so the 90° turn
 *  between them morphs cleanly under morphicons' Procrustes alignment. */
const chevronDown = lucideIcon("chevron-down");
const chevronRight = lucideIcon("chevron-right");
const toolIcon = lucideIcon(props.icon ?? "wrench");

const expanded = ref(false);
// Hover mirrors the old CSS `:hover` affordance: while collapsed, hovering
// morphs the tool icon into a right-pointing chevron; leaving returns it.
const hovered = ref(false);
/** Single morphicons icon: tool icon when idle, chevron on hover/expand. */
const currentIcon = computed<IconNode>(() => {
  if (expanded.value) return chevronDown;
  if (hovered.value) return chevronRight;
  return toolIcon;
});
// immediate: mounts mid-stream start expanded; flips drive open/close.
watch(
  () => props.autoExpand,
  (now) => { if (now !== undefined) expanded.value = !!now; },
  { immediate: true },
);

// bash 执行计时：timeout 是固定上限，第二个数字是从 startedAt 起算的已运行
// 秒数。仅在运行时刷新；结束时先取一次当前时间再停表，重连/延迟渲染也准。
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.running === true && props.timeout !== undefined && props.startedAt !== undefined,
  (active) => {
    now.value = Date.now();
    if (ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }
    if (active) {
      now.value = Date.now();
      ticker = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
});

const remaining = computed(() => {
  if (props.timeout === undefined) return undefined;
  return Math.ceil(props.timeout);
});

const elapsed = computed(() => {
  if (props.startedAt === undefined) return undefined;
  return Math.max(0, Math.floor((now.value - props.startedAt) / 1000));
});
</script>

<template>
  <section class="conversation-detail" :class="{ 'is-expanded': expanded }">
    <button type="button" class="conversation-detail__summary" :aria-expanded="expanded" @click="expanded = !expanded"
      @mouseenter="hovered = true" @mouseleave="hovered = false">
      <span class="conversation-detail__icon-slot" aria-hidden="true">
        <MorphIcon :icon="currentIcon" :size="16" spring="snappy" reduced-motion="user"
          class="conversation-detail__icon" />
      </span>
      <span class="conversation-detail__label">{{ labelText }}</span>
      <FilePathLabel v-if="path" class="conversation-detail__preview" :path="path" :show-prefix="!expanded" />
      <span v-else-if="preview" class="conversation-detail__preview conversation-detail__preview--plain"
        v-show="!expanded || !hidePreviewOnExpand">{{ preview }}</span>
      <span v-if="remaining !== undefined" class="conversation-detail__timeout"
        :title="`Timeout ${timeout}s; running for ${elapsed ?? 0}s`">
        <template v-if="elapsed !== undefined">{{ elapsed }}s / </template>{{ remaining }}s
      </span>
    </button>
    <div class="conversation-detail__body">
      <div class="conversation-detail__body-inner">
        <!-- Every body kind (markdown/diff/images/code/text/ls/grep/paths)
             is rendered by the ToolBodyView TSX component. -->
        <ToolBodyView :body="body" :final="final" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.conversation-detail {
  margin: 0;
  color: var(--ui-text);
  font-size: 14px;
}

.conversation-detail__summary {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.conversation-detail__icon-slot {
  position: relative;
  display: block;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
}

.conversation-detail__icon {
  display: block;
  width: 16px;
  height: 16px;
  overflow: visible;
}

.conversation-detail__label {
  flex: none;
  font-weight: 400;
}

/* Both the path label and plain previews share this muted, ellipsizing slot.
   Note: must stay a block-level flex item (not `display: flex` itself) so
   `text-overflow: ellipsis` applies to the text. FilePathLabel brings its
   own inline-flex layout for icon + prefix + basename. */
.conversation-detail__preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.conversation-detail__preview--plain {
  color: var(--ui-text-muted);
}

/* bash 行尾的 timeout 胶囊：mono + 圆角描边，复用 match-line 的视觉词汇；
 * flex: none 不参与省略号截断，长命令被省略号吃掉时它仍完整可见。 */
.conversation-detail__timeout {
  flex: none;
  padding: 1px 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 999px;
  color: var(--ui-text-muted);
  font-family: var(--ui-font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}

.conversation-detail__body {
  display: grid;
  grid-template-rows: 0fr;
  margin-top: 0;
  opacity: 0;
  transition: grid-template-rows 180ms ease, margin-top 180ms ease, opacity 140ms ease;
}

.conversation-detail__body-inner {
  min-height: 0;
  overflow: hidden;
}

.conversation-detail.is-expanded .conversation-detail__body {
  grid-template-rows: 1fr;
  margin-top: 8px;
  opacity: 1;
}

.conversation-detail.is-expanded .conversation-detail__body-inner {
  padding-left: 24px;
}
</style>
