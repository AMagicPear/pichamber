<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";

const props = withDefaults(
  defineProps<{
    show: boolean;
    /** sm = compact card (about), lg = full workspace (settings). */
    size?: "sm" | "lg";
  }>(),
  { size: "lg" },
);
const emit = defineEmits<{ close: [] }>();

// Esc must work no matter where focus is, so listen on document while open.
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") emit("close");
};
watch(
  () => props.show,
  (show) => {
    if (show) document.addEventListener("keydown", onKeyDown);
    else document.removeEventListener("keydown", onKeyDown);
  },
  { immediate: true },
);
onBeforeUnmount(() => document.removeEventListener("keydown", onKeyDown));
</script>

<template>
  <Transition name="modal">
    <div
      v-if="show"
      class="modal-mask"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <div class="modal-container" :class="`modal-container--${size}`">
        <header class="modal__header">
          <slot name="header">Settings</slot>
        </header>
        <div class="modal__body">
          <slot name="body" />
        </div>
        <div class="modal__footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  transition: opacity 150ms ease;
}
.modal-container {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.modal-container--lg {
  width: 90vw;
  max-width: 1200px;
  height: 85vh;
  max-height: 900px;
}
.modal-container--sm {
  width: calc(100vw - 32px);
  max-width: 300px;
  padding: 24px;
}
.modal-container--sm .modal__body {
  /* Auto-height container: don't let flex-basis:0 collapse the body. */
  flex: none;
}
.modal__header {
  display: none;
}
.modal__body {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
}
.modal__footer {
  display: none;
}

/* Vue Transition: enter / leave follow the demo's scale + opacity pattern */
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.98);
}
</style>
