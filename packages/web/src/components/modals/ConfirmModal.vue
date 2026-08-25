<script setup lang="ts">
import { useI18n } from "vue-i18n";
import Modal from "@/components/ui/Modal.vue";

const { t } = useI18n();

withDefaults(defineProps<{
  show: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
}>(), {
  confirmLabel: undefined,
});

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
  <Modal size="sm" :show="show" @close="emit('close')">
    <template #body>
      <div class="confirm-modal">
        <h3>{{ title }}</h3>
        <p>{{ message }}</p>
        <footer>
          <button type="button" class="confirm-modal__secondary" @click="emit('close')">
            {{ t('common.cancel') }}
          </button>
          <button type="button" class="confirm-modal__primary" @click="emit('confirm')">
            {{ confirmLabel ?? t('common.confirm') }}
          </button>
        </footer>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.confirm-modal {
  display: grid;
  width: 100%;
  gap: 10px;
}

.confirm-modal h3 {
  margin: 0;
  color: var(--ui-text-strong);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.confirm-modal p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.confirm-modal footer {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 3px;
}

.confirm-modal footer button {
  min-height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: 5px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.confirm-modal__secondary {
  background: transparent;
  color: var(--ui-text-muted);
}

.confirm-modal__secondary:hover {
  background: var(--ui-surface-hover);
}

.confirm-modal__primary {
  background: var(--ui-primary);
  box-shadow: var(--ui-shadow-control);
  color: var(--ui-surface);
}

.confirm-modal__primary:hover {
  background: var(--ui-primary-hover);
}
</style>
