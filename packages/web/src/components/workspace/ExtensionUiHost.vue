<script setup lang="ts">
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { onBeforeUnmount, ref, watch } from "vue";
import CloseIcon from "@/assets/icons/Close.svg";
import Modal from "@/components/layout/Modal.vue";

type DialogRequest = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

const props = defineProps<{
  dialog: DialogRequest | null;
  notifications: Array<{ id: string; message: string; type: "info" | "warning" | "error" }>;
}>();

const emit = defineEmits<{
  respond: [response: RpcExtensionUIResponse];
  dismissNotification: [id: string];
}>();

const value = ref("");
let timeoutId: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.dialog,
  (dialog) => {
    clearTimeout(timeoutId);
    value.value = dialog?.method === "editor" ? dialog.prefill ?? "" : "";
    if (dialog && "timeout" in dialog && dialog.timeout) {
      timeoutId = setTimeout(() => cancel(), dialog.timeout);
    }
  },
);
onBeforeUnmount(() => clearTimeout(timeoutId));

const cancel = () => {
  if (props.dialog) emit("respond", { type: "extension_ui_response", id: props.dialog.id, cancelled: true });
};

const submitValue = () => {
  if (!props.dialog) return;
  emit("respond", { type: "extension_ui_response", id: props.dialog.id, value: value.value });
};

const confirm = (confirmed: boolean) => {
  if (!props.dialog) return;
  emit("respond", { type: "extension_ui_response", id: props.dialog.id, confirmed });
};
</script>

<template>
  <Modal size="sm" :show="dialog !== null" @close="cancel">
    <template #body>
      <div v-if="dialog" class="extension-dialog">
        <header>
          <span class="extension-dialog__label">Extension request</span>
          <h3>{{ dialog.title }}</h3>
          <p v-if="dialog.method === 'confirm'">{{ dialog.message }}</p>
        </header>

        <div v-if="dialog.method === 'select'" class="extension-dialog__options">
          <button
            v-for="option in dialog.options"
            :key="option"
            type="button"
            @click="emit('respond', { type: 'extension_ui_response', id: dialog.id, value: option })"
          >
            {{ option }}
          </button>
        </div>

        <input
          v-else-if="dialog.method === 'input'"
          v-model="value"
          autofocus
          :placeholder="dialog.placeholder"
          @keydown.enter="submitValue"
        />
        <textarea
          v-else-if="dialog.method === 'editor'"
          v-model="value"
          autofocus
          rows="8"
          @keydown.meta.enter="submitValue"
          @keydown.ctrl.enter="submitValue"
        />

        <footer v-if="dialog.method !== 'select'">
          <button type="button" class="extension-dialog__secondary" @click="dialog.method === 'confirm' ? confirm(false) : cancel()">
            {{ dialog.method === "confirm" ? "No" : "Cancel" }}
          </button>
          <button type="button" class="extension-dialog__primary" @click="dialog.method === 'confirm' ? confirm(true) : submitValue()">
            {{ dialog.method === "confirm" ? "Yes" : "Continue" }}
          </button>
        </footer>
      </div>
    </template>
  </Modal>

  <div class="extension-notifications" aria-live="polite">
    <div v-for="notification in notifications" :key="notification.id" class="extension-toast" :class="`is-${notification.type}`">
      <span>{{ notification.message }}</span>
      <button type="button" aria-label="Dismiss notification" @click="emit('dismissNotification', notification.id)"><CloseIcon /></button>
    </div>
  </div>
</template>

<style scoped>
.extension-dialog {
  display: grid;
  width: 100%;
  gap: 16px;
}
.extension-dialog header { display: grid; gap: 5px; }
.extension-dialog__label {
  color: #7c776e;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}
.extension-dialog h3 { margin: 0; color: #24221e; font-size: 16px; font-weight: 600; }
.extension-dialog p { margin: 0; color: #706b62; font-size: 13px; line-height: 1.45; }
.extension-dialog input,
.extension-dialog textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #d8d4ca;
  border-radius: 7px;
  outline: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  resize: vertical;
}
.extension-dialog input:focus,
.extension-dialog textarea:focus { border-color: #9eabb9; box-shadow: 0 0 0 2px rgb(91 119 149 / 12%); }
.extension-dialog__options { display: grid; gap: 4px; }
.extension-dialog__options button {
  min-height: 34px;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: #f4f2ed;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.extension-dialog__options button:hover { background: #eae7df; }
.extension-dialog footer { display: flex; justify-content: flex-end; gap: 7px; }
.extension-dialog footer button {
  min-height: 32px;
  padding: 0 13px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.extension-dialog__secondary { background: transparent; color: #666159; }
.extension-dialog__primary { background: #28394b; color: #fff; }
.extension-notifications {
  position: fixed;
  z-index: 120;
  right: 16px;
  bottom: 16px;
  display: grid;
  width: min(340px, calc(100vw - 32px));
  gap: 7px;
}
.extension-toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 10px 10px 12px;
  border: 1px solid #d9d6ce;
  border-left: 3px solid #6f8193;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 7px 22px rgb(0 0 0 / 12%);
  color: #34312c;
  font-size: 13px;
  line-height: 1.4;
}
.extension-toast.is-warning { border-left-color: #b18442; }
.extension-toast.is-error { border-left-color: #a85252; }
.extension-toast span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.extension-toast button { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; color: #777; cursor: pointer; }
.extension-toast svg { width: 13px; height: 13px; }
</style>
