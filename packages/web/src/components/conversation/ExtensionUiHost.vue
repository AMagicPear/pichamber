<script setup lang="ts">
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import CloseIcon from "lucide-static/icons/x.svg";
import Modal from "@/components/ui/Modal.vue";

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

// A select/input/editor title is expected to be a short question, but some
// models stuff a whole paragraph into it. Treat anything beyond a compact
// heading as long-form body text: render it smaller, wrap it, and cap its
// height so it scrolls in place instead of filling the whole modal.
const longTitle = computed(() => (props.dialog?.title.length ?? 0) > 160);

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
          <h3 v-if="!longTitle">{{ dialog.title }}</h3>
          <p v-else class="extension-dialog__title-long">{{ dialog.title }}</p>
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

  <TransitionGroup name="extension-toast" tag="div" class="extension-notifications" aria-live="polite">
    <div v-for="notification in notifications" :key="notification.id" class="extension-toast" :class="`is-${notification.type}`">
      <i aria-hidden="true" />
      <span>{{ notification.message }}</span>
      <button type="button" aria-label="Dismiss notification" @click="emit('dismissNotification', notification.id)"><CloseIcon /></button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.extension-dialog {
  display: grid;
  width: 100%;
  gap: 13px;
  /* Long payloads (ask_user_question selects many big options) can far
   * exceed the fixed-width sm modal. Cap the height and scroll instead
   * of letting the container clip the ends off. */
  max-height: min(65vh, 460px);
  overflow-y: auto;
}
.extension-dialog header { display: grid; gap: 4px; }
.extension-dialog__label {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}
.extension-dialog h3 {
  margin: 0;
  color: var(--ui-text-strong);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
/* A title the model wrote as a whole paragraph stays readable: body-size
 * text instead of a giant heading, and it scrolls in place if it runs
 * longer than ~6 lines so it can't crowd out the choices below. */
.extension-dialog .extension-dialog__title-long {
  margin: 0;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 9.6em;
  overflow-y: auto;
}
.extension-dialog p { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
.extension-dialog input,
.extension-dialog textarea {
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  outline: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  resize: vertical;
  background: var(--ui-surface);
}
.extension-dialog input:focus,
.extension-dialog textarea:focus { border-color: var(--ui-border-focus); box-shadow: 0 0 0 2px rgb(168 146 116 / 12%); }
.extension-dialog__options { display: grid; gap: 3px; }
.extension-dialog__options button {
  min-height: 31px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.extension-dialog__options button:hover { background: var(--ui-surface-hover); }
.extension-dialog footer { display: flex; justify-content: flex-end; gap: 7px; }
.extension-dialog footer button {
  min-height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: 5px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition:
    background-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard),
    transform var(--ui-duration-fast) var(--ui-ease-standard);
}
.extension-dialog__secondary { background: transparent; color: var(--ui-text-muted); }
.extension-dialog__secondary:hover { background: var(--ui-surface-hover); }
.extension-dialog__primary { background: var(--ui-primary); box-shadow: var(--ui-shadow-control); color: var(--ui-surface); }
.extension-dialog__primary:hover { background: var(--ui-primary-hover); transform: translateY(-1px); }
.extension-dialog footer button:active { transform: translateY(1px); }
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
  align-items: center;
  gap: 9px;
  padding: 10px 9px 10px 11px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-raised), 0 1px 2px rgb(35 32 27 / 6%);
  color: var(--ui-text);
  font-size: 13px;
  line-height: 1.4;
}
.extension-toast > i { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #777f84; box-shadow: 0 0 0 3px rgb(119 127 132 / 10%); }
.extension-toast.is-warning > i { background: #a87b36; box-shadow: 0 0 0 3px rgb(168 123 54 / 11%); }
.extension-toast.is-error > i { background: #a6534f; box-shadow: 0 0 0 3px rgb(166 83 79 / 11%); }
.extension-toast span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.extension-toast button { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--ui-text-muted); cursor: pointer; }
.extension-toast button:hover { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.extension-toast svg { width: 13px; height: 13px; }
.extension-toast-enter-active,
.extension-toast-leave-active,
.extension-toast-move {
  transition:
    opacity var(--ui-duration-medium) var(--ui-ease-standard),
    transform 180ms var(--ui-ease-emphasized);
}
.extension-toast-enter-from,
.extension-toast-leave-to {
  opacity: 0;
  transform: translate(8px, 4px);
}

@media (prefers-reduced-motion: reduce) {
  .extension-dialog footer button,
  .extension-toast-enter-active,
  .extension-toast-leave-active,
  .extension-toast-move { transition: none; }
}
</style>
