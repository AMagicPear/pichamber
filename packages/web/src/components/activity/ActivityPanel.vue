<script setup lang="ts">
/* 活动卡片面板：渲染结构化 widget（非 lines，即适配器解析出的 tree 等）。
 * 周围由 ComposerActivityStack 负责弹层/开关，这里只按 kind 分发渲染。 */
import type { ExtensionWidget } from "@/composables/extensionWidgets";
import CloseIcon from "lucide-static/icons/x.svg";
import ActivityTree from "./ActivityTree.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  widgets: Record<string, {
    widget: Exclude<ExtensionWidget, { kind: "lines" }>;
    placement: "aboveEditor" | "belowEditor";
  }>;
}>();
defineEmits<{ close: [] }>();
</script>

<template>
  <section id="activity-panel-surface" class="activity-panel" role="dialog" :aria-label="t('activity.title')">
    <header class="activity-panel__header">
      <span class="activity-panel__label">{{ t('activity.title') }}</span>
      <button type="button" class="activity-panel__close" :aria-label="t('activity.close')" @click="$emit('close')">
        <CloseIcon aria-hidden="true" />
      </button>
    </header>
    <div class="activity-panel__body">
      <article v-for="[key, entry] in Object.entries(widgets)" :key="key" class="activity-panel__widget">
        <!-- 新增结构化 kind 时在这里加一个渲染分支。 -->
        <template v-if="entry.widget.kind === 'tree'">
          <ActivityTree v-for="node in entry.widget.nodes" :key="node.id" :node="node" />
          <p v-if="entry.widget.omitted" class="activity-panel__omitted">+{{ entry.widget.omitted }} more</p>
        </template>
      </article>
    </div>
  </section>
</template>

<style scoped>
.activity-panel {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-raised);
}
.activity-panel__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 7px 8px 7px 11px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.activity-panel__label { color: var(--ui-text-muted); font-size: 11px; font-weight: 600; }
.activity-panel__close {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
}
.activity-panel__close:hover { background: var(--ui-surface-hover); color: var(--ui-text); }
.activity-panel__close:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: -2px; }
.activity-panel__close :deep(svg) { width: 11px; height: 11px; }
.activity-panel__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  padding: 4px 6px 12px;
  overflow-x: hidden;
  overflow-y: auto;
}
.activity-panel__widget + .activity-panel__widget { margin-top: 4px; border-top: 1px solid var(--ui-border-subtle); }
.activity-panel__omitted { margin: 2px 0 2px 23px; color: var(--ui-text-tertiary); font-size: 11px; }
</style>
