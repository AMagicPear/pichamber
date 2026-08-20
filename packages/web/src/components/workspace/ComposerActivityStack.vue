<script setup lang="ts">
/* Owns the local composer/activity composition: a task card sits behind
 * the composer, while the composer and its auxiliary row remain ordinary
 * document flow. The reveal viewport clips animation below the composer
 * edge so the card can never leak from its bottom. */
import type { ExtensionWidget } from "@pichamber/shared";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ActivityPanel from "./ActivityPanel.vue";
import ActivityToggle from "./ActivityToggle.vue";

const props = defineProps<{
  widgets: Record<string, {
    widget: Extract<ExtensionWidget, { kind: "task-tree" }>;
    placement: "aboveEditor" | "belowEditor";
  }>;
  showStatus: boolean;
}>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
const entries = computed(() => Object.entries(props.widgets));
const count = computed(() => entries.value.length);

const close = () => { open.value = false; };
const toggle = () => { if (count.value) open.value = !open.value; };

const onPointerDown = (event: PointerEvent) => {
  if (open.value && !root.value?.contains(event.target as Node)) close();
};
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") close();
};

watch(() => entries.value.map(([key]) => key).join("|"), close);
onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeyDown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <div ref="root" class="composer-activity-stack">
    <div class="composer-activity-stack__layer">
      <div class="composer-activity-stack__reveal">
        <Transition name="activity-card">
          <ActivityPanel v-if="open" :widgets="widgets" @close="close" />
        </Transition>
      </div>
      <slot name="composer" />
    </div>
    <div v-if="count || showStatus" class="composer-activity-stack__status">
      <ActivityToggle v-if="count" :count="count" :expanded="open" @toggle="toggle" />
      <slot name="status" />
    </div>
  </div>
</template>

<style scoped>
.composer-activity-stack { display: flex; flex-direction: column; width: 100%; }
.composer-activity-stack__layer { position: relative; z-index: 0; }
.composer-activity-stack__layer > :deep(.composer) { position: relative; z-index: 2; }
.composer-activity-stack__reveal {
  --activity-card-overlap: 12px;
  position: absolute;
  right: 12px;
  bottom: calc(100% - var(--activity-card-overlap));
  left: 12px;
  z-index: 1;
  height: min(50vh, 320px);
  overflow: clip;
  pointer-events: none;
}
.composer-activity-stack__reveal > :deep(.activity-panel) { pointer-events: auto; }
.composer-activity-stack__status {
  display: flex;
  align-items: center;
  column-gap: 5px;
  min-width: 0;
  padding: 6px 12px 0;
  overflow-x: auto;
  overflow-y: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
  scrollbar-width: none;
  white-space: nowrap;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}
.composer-activity-stack__status::-webkit-scrollbar { display: none; }
.composer-activity-stack__status > :deep(*) { flex: 0 0 auto; }
:global(.activity-card-enter-active), :global(.activity-card-leave-active) {
  transition: opacity 190ms ease, transform 190ms cubic-bezier(0.22, 1, 0.36, 1);
}
:global(.activity-card-enter-from), :global(.activity-card-leave-to) {
  opacity: 0;
  transform: translateY(72px);
}
</style>
