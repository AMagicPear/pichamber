<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelDescriptor } from "@pichamber/shared";
import { ref } from "vue";
import AddCircleIcon from "@/assets/icons/AddCircle.svg";
import Attachment2Icon from "@/assets/icons/Attachment2.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import GithubIcon from "@/assets/icons/Github.svg";
import GitPullRequestIcon from "@/assets/icons/GitPullRequest.svg";
import MicIcon from "@/assets/icons/Mic.svg";
import SendIcon from "@/assets/icons/SendPlane2.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";
import MenuPanel from "@/components/MenuPanel.vue";
import ModelSelector from "@/components/workspace/ModelSelector.vue";
import ThinkingLevelSelector from "@/components/workspace/ThinkingLevelSelector.vue";
import { usePopover } from "@/composables/usePopover";

const draft = defineModel<string | undefined>({ required: true });

defineProps<{
  canSend: boolean;
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
}>();

const emit = defineEmits<{
  send: [];
  selectModel: [model: ModelDescriptor];
  selectThinkingLevel: [level: ThinkingLevel];
}>();

const onKeydown = (event: KeyboardEvent) => {
  // Enter sends; Shift+Enter inserts a newline.
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    emit("send");
  }
};

// The attachment menu is UI-only for now — selecting an item closes the
// menu; actions (file picker, GitHub issue/PR link) land later.
const attachRoot = ref<HTMLElement | null>(null);
const { open: attachOpen, style: attachStyle, close: closeAttach, toggle: toggleAttach } = usePopover({
  root: attachRoot,
  trigger: ".composer__attach-trigger",
  panel: ".menu-panel",
  width: 190,
  // 4px panel padding + three 28px menu rows.
  height: () => 4 + 3 * 28,
});
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
        <div ref="attachRoot" class="composer__attach">
          <IconButton
            class="composer__attach-trigger"
            size="compact"
            label="Add attachment"
            :aria-expanded="attachOpen"
            @click="toggleAttach"
          >
            <AddCircleIcon />
          </IconButton>
          <MenuPanel :open="attachOpen" :style="attachStyle" role="menu" aria-label="Composer actions">
            <button type="button" class="menu-item" role="menuitem" @click="closeAttach">
              <Attachment2Icon />
              Attach files
            </button>
            <button type="button" class="menu-item" role="menuitem" @click="closeAttach">
              <GithubIcon />
              Link GitHub Issue
            </button>
            <button type="button" class="menu-item" role="menuitem" @click="closeAttach">
              <GitPullRequestIcon />
              Link GitHub PR
            </button>
          </MenuPanel>
        </div>
        <IconButton size="compact" label="Expand composer"><FullscreenIcon /></IconButton>
        <IconButton size="compact" label="Goal mode"><TargetIcon /></IconButton>
      </div>
      <div class="composer__footer-trailing">
        <div class="composer__models">
          <ModelSelector
            :model="model"
            :available-models="availableModels"
            @select="emit('selectModel', $event)"
          />
          <ThinkingLevelSelector
            :level="thinkingLevel"
            :available-levels="availableThinkingLevels"
            @select="emit('selectThinkingLevel', $event)"
          />
        </div>
        <IconButton size="compact" label="Dictation"><MicIcon /></IconButton>
        <IconButton size="compact" label="Send" :disabled="!canSend" @click="emit('send')">
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
  width: min(
    calc(100% - var(--conversation-inline-gutter) - var(--conversation-inline-gutter)),
    var(--conversation-content-width)
  );
  overflow: visible;
  border: 1px solid #dedbd2;
  border-radius: 13px;
}
.composer__input {
  display: block;
  flex: 0 0 auto;
  width: 100%;
  min-height: 52px;
  max-height: 204px;
  field-sizing: content;
  box-sizing: border-box;
  padding: 16px 12px 8px;
  border: 0;
  border-radius: 13px 13px 0 0;
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
.composer__footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
}
.composer__footer-leading,
.composer__footer-trailing,
.composer__models {
  display: flex;
  align-items: center;
}
.composer__attach {
  position: relative;
  display: inline-flex;
}
.composer__footer-leading {
  flex: 0 0 auto;
  gap: 6px;
}
.composer__footer-trailing {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.composer__models {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
  gap: 4px;
}
</style>
