<script setup lang="ts">
import AddIcon from "lucide-static/icons/plus.svg";
import BugIcon from "lucide-static/icons/bug.svg";
import CompassIcon from "lucide-static/icons/compass.svg";
import HistoryIcon from "lucide-static/icons/history.svg";
import ScalesIcon from "lucide-static/icons/scale.svg";
import SearchEyeIcon from "lucide-static/icons/search.svg";
import SurveyIcon from "@/assets/icons/Survey.svg";
import TargetIcon from "lucide-static/icons/target.svg";
import { useI18n } from "vue-i18n";
import IconButton from "@/components/ui/IconButton.vue";
import ConversationMessages from "@/components/conversation/messages/ConversationMessages.vue";
import UserInputBlock from "@/components/conversation/composer/UserInputBlock.vue";
import ExtensionUiHost from "@/components/conversation/ExtensionUiHost.vue";
import { useConversationSession } from "@/composables/useConversationSession";
import { dismissNotification, extensionUi, pushInfoToast, pushErrorToast } from "@/stores/extensionUi";
import { workspace } from "@/stores/workspace";
import {
  activity,
  availableModels,
  canRestorePending,
  canSend,
  conversation,
  draft,
  images,
  working,
  model,
  pending,
  shelfCommands,
  thinking,
} from "@/stores/workspace";
import { settings } from "@/stores/settings";
import { computed, watch } from "vue";

const { t } = useI18n();

const presets = computed(() => [
  { label: t('conversation.presets.exploreCodebase'), icon: CompassIcon },
  { label: t('conversation.presets.catchMeUp'), icon: HistoryIcon },
  { label: t('conversation.presets.weighOptions'), icon: ScalesIcon },
  { label: t('conversation.presets.featurePlanning'), icon: SurveyIcon },
  { label: t('conversation.presets.craftGoal'), icon: TargetIcon },
  { label: t('conversation.presets.debugIssue'), icon: BugIcon },
  { label: t('conversation.presets.reviewChanges'), icon: SearchEyeIcon },
]);

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

/** Per-message menu placeholders. The actual fork/copy behavior is not wired
 *  yet — these exist so the UI pattern has an explicit handling point. */
const onMessageFork = () => {
  // TODO: fork conversation at the targeted message.
};

/** Copy the targeted message's text to the system clipboard, with a small
 *  confirmation toast on success / error toast on failure. */
const onMessageCopy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    pushInfoToast(t('conversation.copiedMessage'));
  } catch {
    pushErrorToast(t('conversation.copyFailed'));
  }
};

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
    <ConversationMessages
      v-if="hasConversation"
      :items="conversation"
      :available-models="availableModels"
      :show-timestamps="settings.showTimestamps"
      @fork="onMessageFork"
      @copy="onMessageCopy"
    />
    <h2 v-else>{{ t('conversation.emptyTitle', { folder: workspace.folderName }) }}</h2>

    <UserInputBlock
      v-model="draft"
      v-model:images="images"
      :can-send="canSend"
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

    <div v-if="conversation.length === 0" class="presets" :aria-label="t('conversation.promptStarters')">
      <button
        v-for="preset in presets"
        :key="preset.label"
        type="button"
        @click="draft = preset.label"
      >
        <component :is="preset.icon" />
        <span>{{ preset.label }}</span>
      </button>
      <IconButton class="presets__add" :label="t('conversation.addPromptStarter')" disabled><AddIcon /></IconButton>
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
