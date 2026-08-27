<script setup lang="ts">
/* 活动卡片面板：渲染结构化 widget（非 lines，即适配器解析出的 tree 等）。
 * 周围由 ComposerSurfaceStack 负责弹层/开关，这里只按 kind 分发渲染。 */
import type { ExtensionWidget } from "@/composables/extensionWidgets";
import ActivityTree from "./ActivityTree.vue";
import { useI18n } from "vue-i18n";
import ComposerSurface from "@/components/conversation/composer/ComposerSurface.vue";

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
  <ComposerSurface id="activity-panel-surface" class="activity-panel" :ariaLabel="t('activity.title')" :closeLabel="t('activity.close')" dismissible @close="$emit('close')">
    <template #title><span class="activity-panel__label">{{ t('activity.title') }}</span></template>
    <div class="activity-panel__body">
      <article v-for="[key, entry] in Object.entries(widgets)" :key="key" class="activity-panel__widget">
        <!-- 新增结构化 kind 时在这里加一个渲染分支。 -->
        <template v-if="entry.widget.kind === 'tree'">
          <ActivityTree v-for="node in entry.widget.nodes" :key="node.id" :node="node" />
          <p v-if="entry.widget.omitted" class="activity-panel__omitted">+{{ entry.widget.omitted }} more</p>
        </template>
      </article>
    </div>
  </ComposerSurface>
</template>

<style scoped>
.activity-panel__label { color: var(--ui-text-muted); font-size: 11px; font-weight: 600; }
.activity-panel__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  padding: 4px 6px 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.activity-panel__widget + .activity-panel__widget { margin-top: 4px; border-top: 1px solid var(--ui-border-subtle); }
.activity-panel__omitted { margin: 2px 0 2px 23px; color: var(--ui-text-tertiary); font-size: 11px; }
</style>
