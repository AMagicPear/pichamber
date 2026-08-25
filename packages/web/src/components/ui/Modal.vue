<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";

const props = withDefaults(
  defineProps<{
    show: boolean;
    /** sm = compact card, picker = top-mounted picker, lg = full workspace. */
    size?: "sm" | "lg";
    placement?: "center" | "top";
    /** Whether clicking the backdrop requests the owning surface to close. */
    closeOnBackdrop?: boolean;
    /** Whether Escape requests the owning surface to close. */
    closeOnEscape?: boolean;
  }>(),
  { size: "lg", placement: "center", closeOnBackdrop: true, closeOnEscape: true },
);
const emit = defineEmits<{ close: [] }>();

// Esc must work no matter where focus is, so listen on document while open.
const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape" && props.closeOnEscape) emit("close");
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
      :class="`modal-mask--${placement}`"
      role="dialog"
      aria-modal="true"
      @click.self="closeOnBackdrop && emit('close')"
    >
      <div class="modal-container" :class="[`modal-container--${size}`, `modal-container--${placement}`]">
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
  background: rgb(20 19 17 / 32%);
  transition: opacity 150ms ease;
}
.modal-mask--top {
  align-items: flex-start;
  padding-top: 64px;
}
.modal-container {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-raised);
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
  max-width: 360px;
  padding: 18px;
}
.modal-container--top {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 96px);
}
.modal-container--top.modal-container--sm {
  max-width: 560px;
  padding: 0;
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
.modal-enter-from .modal-container--top,
.modal-leave-to .modal-container--top {
  transform: translateY(-8px);
}
</style>
