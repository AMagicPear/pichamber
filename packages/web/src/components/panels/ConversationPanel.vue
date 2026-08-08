<script setup lang="ts">
import AddIcon from "@/assets/icons/Add.svg";
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
import { entries, workspace } from "@/stores/workspace";
import { watch } from "vue";

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
  live,
  send,
  model,
  availableModels,
  thinking,
  setModel,
  setThinkingLevel,
} = useConversationSession(entries);

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
  <section class="conversation" :class="{ 'conversation--active': entries.length > 0 || live.pendingUserMessages.length > 0 || live.streamingMessage }">
    <ConversationMessages
      v-if="entries.length > 0 || live.pendingUserMessages.length > 0 || live.streamingMessage || live.toolExecutions.length > 0"
      :entries="entries"
      :live="live"
    />
    <h2 v-else>What are we working on in {{ workspace.folderName }}?</h2>

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

    <div v-if="entries.length === 0 && live.pendingUserMessages.length === 0 && !live.streamingMessage" class="presets" aria-label="Prompt starters">
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
