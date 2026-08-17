<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import { computed, ref, watch, type Component } from "vue";
import FolderIcon from "@/assets/icons/Folder.svg";
import FileTextIcon from "@/assets/icons/FileText.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
import ArrowDownIcon from "@/assets/icons/ArrowDownS.svg";
import FilePathLabel from "@/components/FilePathLabel.vue";
import CodeView from "./CodeView.vue";
import DiffView from "./DiffView.vue";
import { getEntryIcon } from "./fileIcon";
import { type ToolBody } from "./toolBody";

const props = defineProps<{
  icon?: Component | string;
  label: string;
  preview?: string;
  /** Full file path — rendered filename-first via FilePathLabel. */
  path?: string;
  /** Body shape — the dispatcher picks a renderer from `body.kind`. */
  body: ToolBody;
  /** Auto-expand while true (caller flips it when streaming starts) and
   *  auto-collapse when it flips false (streaming segment ended). Manual
   *  toggles between the flips are respected. */
  autoExpand?: boolean;
  /** Hide the plain preview line while expanded. Summary-type previews
   *  (Thinking: same text as the body) are redundant when open; header-type
   *  previews (bash command / ls path) stay visible. */
  hidePreviewOnExpand?: boolean;
}>();

const expanded = ref(false);
// immediate: mounts mid-stream start expanded; flips drive open/close.
watch(
  () => props.autoExpand,
  (now) => { expanded.value = !!now; },
  { immediate: true },
);

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
    </button>
    <div class="conversation-detail__body">
      <div class="conversation-detail__body-inner">
        <MarkdownRender
          v-if="body.kind === 'markdown'"
          class="conversation-detail__markdown markdown-chat"
          mode="chat"
          :content="body.content"
          :final="true"
          :fade="false"
          :viewport-priority="false"
        />
        <DiffView v-else-if="body.kind === 'diff'" class="conversation-detail__diff" :patch="body.patch" />
        <div v-else-if="body.kind === 'images'" class="conversation-detail__images">
          <img
            v-for="(img, i) in body.images"
            :key="i"
            :src="`data:${img.mimeType};base64,${img.data}`"
            alt="Read image"
          />
        </div>
        <CodeView
          v-else-if="body.kind === 'code'"
          class="conversation-detail__code"
          :content="body.content"
          :fileName="body.fileName"
        />
        <div v-else-if="body.kind === 'text'" class="conversation-detail__text">
          <div class="conversation-detail__text-header" aria-hidden="true">
            <TerminalIcon class="conversation-detail__text-icon" />
            <span>Output</span>
          </div>
          <pre class="conversation-detail__text-pre">{{ body.content }}</pre>
        </div>
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

/* Plain text (bash / unknown tools): scrollable code box. Long paths and
 * shell output stay readable; horizontal scroll kicks in for over-long
 * lines instead of breaking them mid-token via overflow-wrap: anywhere. */
.conversation-detail__text {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
}
.conversation-detail__text-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.conversation-detail__text-icon {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
}
.conversation-detail__text-pre {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  max-height: 420px;
  color: var(--ui-text);
  font-family: var(--ui-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre;        /* preserve newlines; let the box scroll horizontally */
  overflow-wrap: normal;
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
  font-family: var(--ui-font-mono, ui-monospace, monospace);
  font-size: 11px;
  text-align: center;
}
.conversation-detail__match-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-text-secondary);
  font-family: var(--ui-font-mono, ui-monospace, monospace);
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