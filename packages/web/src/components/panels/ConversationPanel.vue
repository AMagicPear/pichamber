<script setup lang="ts">
import AddIcon from "@/assets/icons/Add.svg";
import CloseIcon from "@/assets/icons/Close.svg";
import BugIcon from "@/assets/icons/Bug.svg";
import CompassIcon from "@/assets/icons/Compass3.svg";
import HistoryIcon from "@/assets/icons/History.svg";
import ScalesIcon from "@/assets/icons/Scales3.svg";
import SearchEyeIcon from "@/assets/icons/SearchEye.svg";
import SurveyIcon from "@/assets/icons/Survey.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";
import ConversationMessages from "@/components/workspace/ConversationMessages.vue";
import UserInputBlock from "@/components/workspace/UserInputBlock.vue";
import { useConversationSession } from "@/composables/useConversationSession";
import { workspace } from "@/stores/workspace";
import { computed, watch } from "vue";

const presets = [
  { label: "Explore the codebase", icon: CompassIcon },
  { label: "Catch me up", icon: HistoryIcon },
  { label: "Weigh my options", icon: ScalesIcon },
  { label: "Start feature planning", icon: SurveyIcon },
  { label: "Craft a Goal", icon: TargetIcon },
  { label: "Debug an issue", icon: BugIcon },
  { label: "Review my changes", icon: SearchEyeIcon },
];

const {
  draft,
  canSend,
  connect,
  disconnect,
  dismissError,
  lastError,
  items,
  send,
  model,
  availableModels,
  thinking,
  setModel,
  setThinkingLevel,
} = useConversationSession();

const hasConversation = computed(() => items.value.length > 0);

watch(
  () => workspace.sessionId,
  (sessionId) => {
    if (sessionId) connect(sessionId);
    else disconnect();
  },
  { immediate: true },
);
</script>

<template>
  <section class="conversation" :class="{ 'conversation--active': hasConversation }">
    <ConversationMessages v-if="hasConversation" :items="items" />
    <h2 v-else>What are we working on in {{ workspace.folderName }}?</h2>

    <div v-if="lastError" class="conversation__error" role="alert">
      <BugIcon class="conversation__error-icon" />
      <span class="conversation__error-text">{{ lastError }}</span>
      <button type="button" class="conversation__error-close" aria-label="Dismiss error" @click="dismissError">
        <CloseIcon />
      </button>
    </div>

    <UserInputBlock
      v-model="draft"
      :can-send="canSend"
      :model="model"
      :available-models="availableModels"
      :thinking-level="thinking.level"
      :available-thinking-levels="thinking.availableLevels"
      @send="send"
      @select-model="setModel"
      @select-thinking-level="setThinkingLevel"
    />

    <div v-if="items.length === 0" class="presets" aria-label="Prompt starters">
      <button
        v-for="preset in presets"
        :key="preset.label"
        type="button"
        @click="draft = preset.label"
      >
        <component :is="preset.icon" />
        <span>{{ preset.label }}</span>
      </button>
      <IconButton class="presets__add" label="Add prompt starter"><AddIcon /></IconButton>
    </div>
  </section>
</template>

<style scoped>
.conversation {
  --conversation-content-width: 44rem;
  --conversation-shell-width: 48rem;
  --conversation-inline-gutter: 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding-block: 0 16px;
  gap: 24px;
}
.conversation--active {
  justify-content: flex-start;
  gap: 0;
}
.conversation h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.02em;
  text-align: center;
}
.conversation__error {
  display: flex;
  width: min(100%, var(--conversation-shell-width));
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid #f4c2c2;
  border-radius: 10px;
  background: rgb(255 240 240 / 80%);
  color: #6f2828;
  font-size: 13px;
  line-height: 1.4;
}
.conversation__error-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  color: #a83838;
}
.conversation__error-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.conversation__error-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #6f2828;
  cursor: pointer;
}
.conversation__error-close:hover {
  background: rgb(168 56 56 / 12%);
}
.conversation__error-close svg {
  width: 14px;
  height: 14px;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 7px;
  width: min(100%, 500px);
}
.presets > button:not(.presets__add) {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid #d9d7cf;
  border-radius: 999px;
  color: #666;
  font-size: 14px;
  line-height: 18px;
}
.presets > button:not(.presets__add) svg {
  width: 14px;
  height: 14px;
  opacity: 0.7;
}
.presets > button:hover {
  background: rgb(0 0 0 / 4%);
}
.presets > :deep(.presets__add) {
  border: 1px solid #d9d7cf;
  border-radius: 999px;
  color: #666;
}
.conversation--active .presets {
  display: none;
}
</style>
