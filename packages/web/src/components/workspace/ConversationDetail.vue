<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import { ref, type Component } from "vue";
import ArrowDownIcon from "@/assets/icons/ArrowDownS.svg";
import FilePathLabel from "@/components/FilePathLabel.vue";

defineProps<{
  icon?: Component | string;
  label: string;
  preview?: string;
  content: string;
  /** Full file path — rendered filename-first via FilePathLabel. */
  path?: string;
  /** Render `content` as markdown instead of verbatim (tool output stays raw). */
  renderMarkdown?: boolean;
}>();

const expanded = ref(false);
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
      <span v-else-if="preview" class="conversation-detail__preview conversation-detail__preview--plain">{{ preview }}</span>
    </button>
    <div class="conversation-detail__body">
      <div class="conversation-detail__body-inner">
        <MarkdownRender
          v-if="renderMarkdown"
          class="conversation-detail__markdown markdown-chat"
          mode="chat"
          :content="content"
          :final="true"
          :fade="false"
        />
        <pre v-else class="conversation-detail__content">{{ content }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.conversation-detail {
  margin: 0;
  color: #292827;
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
  color: #76746d;
}
.conversation-detail__content,
.conversation-detail__markdown {
  margin: 0;
  color: #76746d;
}
.conversation-detail__content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
  border-left: 1px solid #dedbd4;
}
</style>
