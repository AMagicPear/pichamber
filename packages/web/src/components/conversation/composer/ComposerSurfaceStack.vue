<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

defineProps<{
  open: boolean;
  showStatus: boolean;
}>();

const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLElement | null>(null);

const onPointerDown = (event: PointerEvent) => {
  if (!root.value?.contains(event.target as Node)) emit("close");
};
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") emit("close");
};

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
  <div ref="root" class="composer-surface-stack">
    <div class="composer-surface-stack__layer">
      <div class="composer-surface-stack__reveal">
        <Transition name="composer-surface">
          <slot v-if="open" name="surface" />
        </Transition>
      </div>
      <slot name="composer" />
    </div>
    <div v-if="showStatus" class="composer-surface-stack__status"><slot name="status" /></div>
  </div>
</template>

<style scoped>
.composer-surface-stack { display: flex; flex-direction: column; width: 100%; }
.composer-surface-stack__layer { position: relative; z-index: 0; }
.composer-surface-stack__layer > :deep(.composer) { position: relative; z-index: 2; }
.composer-surface-stack__reveal {
  --composer-surface-overlap: 12px;
  position: absolute;
  right: 12px;
  bottom: calc(100% - var(--composer-surface-overlap));
  left: 12px;
  z-index: 1;
  height: min(34vh, 280px);
  overflow: clip;
  pointer-events: none;
}
.composer-surface-stack__reveal > :deep(.composer-surface) { pointer-events: auto; }
.composer-surface-stack__status {
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
.composer-surface-stack__status::-webkit-scrollbar { display: none; }
.composer-surface-stack__status > :deep(*) { flex: 0 0 auto; }
:global(.composer-surface-enter-active), :global(.composer-surface-leave-active) {
  transition: opacity 190ms ease, transform 190ms cubic-bezier(0.22, 1, 0.36, 1);
}
:global(.composer-surface-enter-from), :global(.composer-surface-leave-to) {
  opacity: 0;
  transform: translateY(72px);
}
</style>
