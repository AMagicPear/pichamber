<script setup lang="ts">
import AddIcon from "@/assets/icons/Add.svg";
import BugIcon from "@/assets/icons/Bug.svg";
import CompassIcon from "@/assets/icons/Compass3.svg";
import HistoryIcon from "@/assets/icons/History.svg";
import ScalesIcon from "@/assets/icons/Scales3.svg";
import SearchEyeIcon from "@/assets/icons/SearchEye.svg";
import SurveyIcon from "@/assets/icons/Survey.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/ui/IconButton.vue";
import ConversationMessages from "@/components/conversation/messages/ConversationMessages.vue";
import UserInputBlock from "@/components/conversation/composer/UserInputBlock.vue";
import ExtensionUiHost from "@/components/conversation/ExtensionUiHost.vue";
import { useConversationSession } from "@/composables/useConversationSession";
import { dismissNotification, extensionUi } from "@/stores/extensionUi";
import { workspace } from "@/stores/workspace";
import {
  activity,
  availableModels,
  canRestorePending,
  canSend,
  conversation,
  draft,
  images,
  isBusy,
  model,
  pending,
  shelfCommands,
  thinking,
} from "@/stores/workspace";
import { settings } from "@/stores/settings";
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
  abort,
  compact,
  connect,
  disconnect,
  prompt,
  respondToExtension,
  restorePending,
  setModel,
  setThinkingLevel,
} = useConversationSession();

/** 对齐官方 `prompt(text, options?)`：composer 的草稿/图片在 store，
 *  发送时把草稿文本和 streaming 行为交给官方签名的动作。 */
const onSend = (behavior?: "steer" | "followUp") => {
  prompt(draft.value ?? "", { streamingBehavior: behavior });
};

const hasConversation = computed(() => conversation.value.length > 0);

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
    <ConversationMessages v-if="hasConversation" :items="conversation" :available-models="availableModels" :show-timestamps="settings.showTimestamps" />
    <h2 v-else>What are we working on in {{ workspace.folderName }}?</h2>

    <UserInputBlock
      v-model="draft"
      v-model:images="images"
      :can-send="canSend"
      :busy="isBusy"
      :activity="activity"
      :pending="pending"
      :can-restore-pending="canRestorePending"
      :commands="shelfCommands"
      :extension-statuses="extensionUi.statuses"
      :extension-widgets="extensionUi.widgets"
      :model="model"
      :available-models="availableModels"
      :thinking-level="thinking.level"
      :available-thinking-levels="thinking.availableLevels"
      :send-key="settings.sendKey"
      @send="onSend"
      @abort="abort"
      @compact="compact"
      @restore-pending="restorePending"
      @select-model="setModel"
      @select-thinking-level="setThinkingLevel"
    />

    <ExtensionUiHost
      :dialog="extensionUi.dialog"
      :notifications="extensionUi.notifications"
      @respond="respondToExtension"
      @dismiss-notification="dismissNotification"
    />

    <div v-if="conversation.length === 0" class="presets" aria-label="Prompt starters">
      <button
        v-for="preset in presets"
        :key="preset.label"
        type="button"
        @click="draft = preset.label"
      >
        <component :is="preset.icon" />
        <span>{{ preset.label }}</span>
      </button>
      <IconButton class="presets__add" label="Add prompt starter" disabled><AddIcon /></IconButton>
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
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 18px;
}
.presets > button:not(.presets__add) svg {
  width: 14px;
  height: 14px;
  opacity: 0.7;
}
.presets > button:hover {
  background: var(--ui-surface-hover);
}
.presets > :deep(.presets__add) {
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text-muted);
}
.conversation--active .presets {
  display: none;
}
</style>
