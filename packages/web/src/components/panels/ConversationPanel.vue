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
import UserInputBlock from "@/components/workspace/UserInputBlock.vue";
import { useConversationSession } from "@/composables/useConversationSession";

const presets = [
  { label: "Explore the codebase", icon: CompassIcon },
  { label: "Catch me up", icon: HistoryIcon },
  { label: "Weigh my options", icon: ScalesIcon },
  { label: "Start feature planning", icon: SurveyIcon },
  { label: "Craft a Goal", icon: TargetIcon },
  { label: "Debug an issue", icon: BugIcon },
  { label: "Review my changes", icon: SearchEyeIcon },
];

const { messages, draft, canSend, send, usePreset } = useConversationSession();
</script>

<template>
  <main class="conversation" :class="{ 'conversation--active': messages.length > 0 }">
    <div v-if="messages.length > 0" class="conversation__messages">
      <div
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="`message--${message.role}`"
      >
        <p class="message__content">{{ message.content }}</p>
      </div>
    </div>
    <h2 v-else>What are we working<br />on in amagicpear?</h2>

    <UserInputBlock v-model="draft" :can-send="canSend" @send="send" />

    <div v-if="messages.length === 0" class="presets" aria-label="Prompt starters">
      <button
        v-for="preset in presets"
        :key="preset.label"
        type="button"
        @click="usePreset(preset.label)"
      >
        <component :is="preset.icon" />
        <span>{{ preset.label }}</span>
      </button>
      <IconButton class="presets__add" label="Add prompt starter"><AddIcon /></IconButton>
    </div>
  </main>
</template>

<style scoped>
.conversation {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 24px 24px 16px;
  overflow: hidden;
}
.conversation--active {
  justify-content: flex-start;
}
.conversation__messages {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  width: min(100%, 1280px);
  min-height: 0;
  padding: 24px 0 8px;
  overflow-y: auto;
  scrollbar-width: none;
}
.conversation__messages::-webkit-scrollbar {
  display: none;
}
.conversation h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.02em;
  text-align: center;
}
.message {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 10px;
}
.message--user {
  align-self: flex-end;
  max-width: 72%;
  background: #f0eee8;
}
.message--assistant {
  align-self: flex-start;
}
.message--error {
  align-self: stretch;
  background: #fdecec;
  color: #b3261e;
}
.message__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 20px;
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
