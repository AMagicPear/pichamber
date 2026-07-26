<script setup lang="ts">
defineOptions({ name: "SettingsModal" });

defineProps<{ show: boolean }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Transition name="settings-modal">
    <div
      v-if="show"
      class="settings-modal-mask"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <div class="settings-modal-container">
        <header class="settings-modal__header">
          <slot name="header">Settings</slot>
        </header>
        <div class="settings-modal__body">
          <slot name="body" />
        </div>
        <div class="settings-modal__footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settings-modal-mask {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  transition: opacity 150ms ease;
}
.settings-modal-container {
  position: relative;
  display: flex;
  width: 90vw;
  max-width: 1200px;
  height: 85vh;
  max-height: 900px;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.18);
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.settings-modal__header {
  display: none;
}
.settings-modal__body {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
}
.settings-modal__footer {
  display: none;
}

/* Vue Transition: enter / leave follow the demo's scale + opacity pattern */
.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}
.settings-modal-enter-from .settings-modal-container,
.settings-modal-leave-to .settings-modal-container {
  transform: scale(0.98);
}
</style>