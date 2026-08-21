<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Component } from "vue";
import FolderIcon from "@/assets/icons/Folder.svg";
import FileTextIcon from "@/assets/icons/FileText.svg";
import ArrowDownIcon from "@/assets/icons/ArrowDownS.svg";
import FilePathLabel from "@/components/ui/FilePathLabel.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import CodeView from "../../ui/CodeView.vue";
import DiffView from "../../panels/DiffView.vue";
import { getEntryIcon } from "../../ui/fileIcon";
import { type ToolBody } from "./toolBody";

const props = defineProps<{
  icon?: Component | string;
  label: string;
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
  /** Auto-expand while true (caller flips it when streaming starts) and
   *  auto-collapse when it flips false (streaming segment ended). Manual
   *  toggles between the flips are respected. */
  autoExpand?: boolean;
  /** Initial expanded state for tool-result details where there's no
   *  streaming segment to react to. Only consults at mount — doesn't
   *  override later manual toggles — so the user's collapse preference
   *  survives a re-render. */
  defaultExpanded?: boolean;
  /** Hide the plain preview line while expanded. Summary-type previews
   *  (Thinking: same text as the body) are redundant when open; header-type
   *  previews (bash command / ls path) stay visible. */
  hidePreviewOnExpand?: boolean;
}>();

// Initial state honours the per-item preference (tool results want a
// quiet default; Thinking wants to start collapsed). The autoExpand
// watcher below only kicks in for callers that flip `autoExpand` during
// the lifetime (Thinking during streaming); tool-result callers leave it
// undefined and never trip the watcher.
const expanded = ref(!!props.defaultExpanded);
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

// Per-kind content text for the structured lists — a one-line muted summary
// shown above the entries so a user scanning the message log can tell apart
// `ls src` from `ls docs` without expanding.
const entriesHeading = computed(() => {
  const body = props.body;
  if (body.kind === "ls") return body.entries.length === 0 ? "empty directory" : `${body.entries.length} entries`;
  if (body.kind === "grep") return body.matches.length === 0 ? "no matches" : `${body.matches.length} matches`;
  if (body.kind === "paths") return body.paths.length === 0 ? "no files" : `${body.paths.length} files`;
  return null;
});

const showNotes = computed(() => {
  const body = props.body;
  return (body.kind === "ls" || body.kind === "grep" || body.kind === "paths") && body.notes.length > 0;
});
</script>

<template>
  <section class="conversation-detail" :class="{ 'is-expanded': expanded }">
    <button type="button" class="conversation-detail__summary" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="conversation-detail__icon-slot" aria-hidden="true">
        <component :is="icon" class="conversation-detail__icon" />
        <ArrowDownIcon class="conversation-detail__arrow" />
      </span>
      <span class="conversation-detail__label">{{ label }}</span>
      <FilePathLabel
        v-if="path"
        class="conversation-detail__preview"
        :path="path"
        :show-prefix="!expanded"
      />
      <span
        v-else-if="preview"
        class="conversation-detail__preview conversation-detail__preview--plain"
        v-show="!expanded || !hidePreviewOnExpand"
      >{{ preview }}</span>
      <span
        v-if="remaining !== undefined"
        class="conversation-detail__timeout"
        :title="`Timeout ${timeout}s; running for ${elapsed ?? 0}s`"
      >
        <template v-if="elapsed !== undefined">{{ elapsed }}s / </template>{{ remaining }}s
      </span>
    </button>
    <div class="conversation-detail__body">
      <div class="conversation-detail__body-inner">
        <ChatMarkdown
          v-if="body.kind === 'markdown'"
          class="conversation-detail__markdown"
          :content="body.content"
        />
        <DiffView v-else-if="body.kind === 'diff'" class="conversation-detail__diff" :patch="body.patch" />
        <div v-else-if="body.kind === 'images'" class="conversation-detail__images">
          <img
            v-for="(img, i) in body.images"
            :key="i"
            :src="`data:${img.mimeType};base64,${img.data}`"
            alt="Read image"
            loading="lazy"
            decoding="async"
          />
        </div>
        <CodeView
          v-else-if="body.kind === 'code'"
          class="conversation-detail__code"
          :content="body.content"
          :fileName="body.fileName"
        />
        <pre v-else-if="body.kind === 'text'" class="conversation-detail__text">{{ body.content }}</pre>
        <div v-else-if="body.kind === 'ls'" class="conversation-detail__list">
          <div v-if="entriesHeading" class="conversation-detail__list-heading">{{ entriesHeading }}</div>
          <ul v-if="body.entries.length > 0" class="conversation-detail__list-items">
            <li v-for="(entry, i) in body.entries" :key="`${i}:${entry.name}`" class="conversation-detail__list-row">
              <svg v-if="getEntryIcon(entry.name, entry.isDir, false)" class="conversation-detail__list-icon" aria-hidden="true">
                <use :href="getEntryIcon(entry.name, entry.isDir, false)" />
              </svg>
              <FolderIcon v-else-if="entry.isDir" class="conversation-detail__list-icon" aria-hidden="true" />
              <FileTextIcon v-else class="conversation-detail__list-icon" aria-hidden="true" />
              <span class="conversation-detail__list-name">{{ entry.name }}</span>
            </li>
          </ul>
          <p v-else class="conversation-detail__list-empty">Empty directory</p>
          <p v-if="showNotes" class="conversation-detail__list-notes">{{ body.notes.join(" · ") }}</p>
        </div>
        <div v-else-if="body.kind === 'grep'" class="conversation-detail__list">
          <div v-if="entriesHeading" class="conversation-detail__list-heading">{{ entriesHeading }}</div>
          <ul v-if="body.matches.length > 0" class="conversation-detail__list-items conversation-detail__list-items--matches">
            <li v-for="(m, i) in body.matches" :key="`${i}:${m.file}:${m.line}`" class="conversation-detail__match">
              <FilePathLabel class="conversation-detail__match-path" :path="m.file" :show-prefix="false" />
              <span class="conversation-detail__match-line">{{ m.line }}</span>
              <span class="conversation-detail__match-text">{{ m.text }}</span>
            </li>
          </ul>
          <p v-else class="conversation-detail__list-empty">No matches</p>
          <p v-if="showNotes" class="conversation-detail__list-notes">{{ body.notes.join(" · ") }}</p>
        </div>
        <div v-else-if="body.kind === 'paths'" class="conversation-detail__list">
          <div v-if="entriesHeading" class="conversation-detail__list-heading">{{ entriesHeading }}</div>
          <ul v-if="body.paths.length > 0" class="conversation-detail__list-items">
            <li v-for="(p, i) in body.paths" :key="`${i}:${p}`" class="conversation-detail__list-row">
              <svg v-if="getEntryIcon(p, false, false)" class="conversation-detail__list-icon" aria-hidden="true">
                <use :href="getEntryIcon(p, false, false)" />
              </svg>
              <FileTextIcon v-else class="conversation-detail__list-icon" aria-hidden="true" />
              <FilePathLabel class="conversation-detail__list-name" :path="p" :show-prefix="false" />
            </li>
          </ul>
          <p v-else class="conversation-detail__list-empty">No files</p>
          <p v-if="showNotes" class="conversation-detail__list-notes">{{ body.notes.join(" · ") }}</p>
        </div>
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
  position: absolute;
  inset: 0;
  width: 16px;
  height: 16px;
  object-fit: contain;
  transition: opacity 160ms ease;
}
.conversation-detail__arrow {
  position: absolute;
  inset: 0;
  width: 16px;
  height: 16px;
  opacity: 0;
  transform: rotate(-90deg);
  transition: opacity 160ms ease, transform 180ms ease;
}
.conversation-detail:hover .conversation-detail__icon {
  opacity: 0;
}
.conversation-detail:hover .conversation-detail__arrow {
  opacity: 1;
}
.conversation-detail.is-expanded .conversation-detail__icon {
  opacity: 0;
}
.conversation-detail.is-expanded .conversation-detail__arrow {
  opacity: 1;
  transform: rotate(0deg);
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
.conversation-detail__markdown {
  margin: 0;
  color: var(--ui-text-muted);
}
/* DiffView 自带滚动盒，这里只要撑满展开区的宽度。 */
.conversation-detail__diff {
  max-width: 100%;
  min-width: 0;
}
/* 图片附件缩略图：与用户消息里的图片风格一致——封顶宽度但不被强制放大。 */
.conversation-detail__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.conversation-detail__images img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
  object-fit: contain;
}

/* Plain text (bash / unknown tools / JSON fallback): bare monospace output —
 * no box, the expanded body's left border anchors it. Auto-wrap at the
 * container edge (pre-wrap keeps newlines + indentation); long unbroken
 * tokens (JSON values, paths, URLs) break via overflow-wrap so nothing
 * forces horizontal scroll. Only vertical scrolling remains for long
 * outputs. */
.conversation-detail__text {
  margin: 0;
  overflow: auto;
  max-height: 420px;
  color: var(--ui-text);
  font-family: var(--ui-font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;   /* preserve newlines, wrap at the container edge */
  overflow-wrap: break-word; /* break only when a token can't fit on its own line */
  word-break: normal;
}

/* Structured list (ls / find / grep): inset card with a muted heading and
 * one row per entry. Rows reuse the file-icon vocabulary from the file panel
 * so folders / files read like a familiar directory listing. */
.conversation-detail__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
  color: var(--ui-text);
}
.conversation-detail__list-heading {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.conversation-detail__list-items {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.conversation-detail__list-items--matches {
  gap: 4px;
}
.conversation-detail__list-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.5;
}
.conversation-detail__list-row:hover {
  background: var(--ui-surface);
}
.conversation-detail__list-icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  object-fit: contain;
}
.conversation-detail__list-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-detail__match {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 2fr);
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  padding: 4px 6px;
  border-left: 2px solid var(--ui-border);
  background: var(--ui-surface);
  border-radius: 0 4px 4px 0;
  font-size: 13px;
  line-height: 1.45;
}
.conversation-detail__match-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text);
}
.conversation-detail__match-line {
  flex: none;
  min-width: 2.5em;
  padding: 0 6px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 999px;
  color: var(--ui-text-muted);
  font-family: var(--ui-font-mono);
  font-size: 11px;
  text-align: center;
}
.conversation-detail__match-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-secondary);
  font-family: var(--ui-font-mono);
  font-size: 12.5px;
}
.conversation-detail__list-empty,
.conversation-detail__list-notes {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}
.conversation-detail__list-notes {
  padding-top: 4px;
  border-top: 1px dashed var(--ui-border-subtle);
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
  border-left: 1px solid var(--ui-border);
}
</style>
