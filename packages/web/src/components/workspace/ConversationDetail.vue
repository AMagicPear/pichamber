<script setup lang="ts">
import type { Component } from "vue";

defineProps<{
  icon?: Component | string;
  iconUrl?: string;
  label: string;
  preview?: string;
  previewTail?: string;
  content: string;
}>();
</script>

<template>
  <details class="conversation-detail">
    <summary class="conversation-detail__summary">
      <img v-if="iconUrl" :src="iconUrl" class="conversation-detail__icon" alt="" />
      <component v-else :is="icon" class="conversation-detail__icon" />
      <span class="conversation-detail__label">{{ label }}</span>
      <span v-if="preview || previewTail" class="conversation-detail__preview">
        <span v-if="preview" class="conversation-detail__preview-prefix">{{ preview }}</span>
        <span v-if="previewTail" class="conversation-detail__preview-tail">{{ previewTail }}</span>
      </span>
    </summary>
    <pre class="conversation-detail__content">{{ content }}</pre>
  </details>
</template>

<style scoped>
.conversation-detail {
  margin: 0;
  color: #292827;
  font-size: 14px;
}
.conversation-detail__summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.conversation-detail__icon {
  display: block;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  object-fit: contain;
}
.conversation-detail__label {
  flex: none;
  font-weight: 400;
}
.conversation-detail__preview {
  display: flex;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
}
.conversation-detail__preview-prefix {
  min-width: 0;
  overflow: hidden;
  color: #76746d;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conversation-detail__preview-tail {
  flex: none;
  color: #292827;
}
.conversation-detail__content {
  margin: 0;
  color: #76746d;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.conversation-detail[open] .conversation-detail__content {
  margin-top: 6px;
}
</style>
