<script setup lang="ts">
import AddCircleIcon from "@/assets/icons/AddCircle.svg";
import AiAgentIcon from "@/assets/icons/AiAgent.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import MicIcon from "@/assets/icons/Mic.svg";
import SendIcon from "@/assets/icons/SendPlane2.svg";
import ShieldUserIcon from "@/assets/icons/ShieldUser.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  submit: [text: string];
}>();

const draft = ref("");
const canSubmit = computed(() => !props.disabled && draft.value.trim().length > 0);

const submit = () => {
  const text = draft.value.trim();
  if (!canSubmit.value) return;
  emit("submit", text);
  draft.value = "";
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
};
</script>

<template>
  <div class="composer">
    <textarea
      v-model="draft"
      class="composer__input"
      placeholder="@ for files/agents; / for commands and skills; ! for shell; # for snippets"
      rows="1"
      @keydown="onKeydown"
    />
    <div class="composer__footer">
      <div class="composer__footer-leading">
        <IconButton size="compact" label="Add attachment"><AddCircleIcon /></IconButton>
        <IconButton size="compact" label="Expand composer"><FullscreenIcon /></IconButton>
        <IconButton size="compact" label="Permissions"><ShieldUserIcon /></IconButton>
        <IconButton size="compact" label="Goal mode"><TargetIcon /></IconButton>
      </div>
      <div class="composer__footer-trailing">
        <div class="composer__models">
          <strong class="model-control"><span class="model-mark">Ƶ</span> Big Pickle</strong>
          <span class="model-control model-mode"><AiAgentIcon class="model-icon" />Build</span>
        </div>
        <IconButton size="compact" label="Dictation"><MicIcon /></IconButton>
        <IconButton size="compact" label="Send" :disabled="!canSubmit" @click="submit">
          <SendIcon />
        </IconButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  width: min(100%, 464px);
  overflow: hidden;
  border: 1px solid #dedbd2;
  border-radius: 13px;
}
.composer__input {
  display: block;
  width: 100%;
  min-height: 52px;
  max-height: 204px;
  field-sizing: content;
  box-sizing: border-box;
  padding: 16px 12px 8px;
  border: 0;
  outline: 0;
  overflow-x: hidden;
  overflow-y: auto;
  resize: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  background: transparent;
}
.composer__input::placeholder {
  color: #747474;
}
.composer__footer,
.composer__footer-leading,
.composer__footer-trailing,
.composer__models,
.model-control {
  display: flex;
  align-items: center;
}
.composer__footer {
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
}
.composer__footer-leading {
  gap: 6px;
}
.composer__footer-trailing {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
  gap: 6px;
}
.composer__models {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
  gap: 12px;
}
.model-control {
  gap: 6px;
  min-width: 0;
  height: 32px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
}
.model-mode,
.model-icon {
  color: #718d28;
}
.model-mark {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}
</style>
