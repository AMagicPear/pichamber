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
import ExtensionUiHost from "@/components/workspace/ExtensionUiHost.vue";
import type { ExtensionWidget, ExtensionWidgetPlacement } from "@amagicpear/pichamber-shared";
import { useConversationSession } from "@/composables/useConversationSession";
import { workspace } from "@/stores/workspace";
import {
  activity,
  availableModels,
  busy,
  canRestorePending,
  canSend,
  draft,
  extensionUi,
  images,
  items,
  model,
  pending,
  resources,
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
  dismissNotification,
  respondToExtension,
  restorePending,
  send,
  setModel,
  setThinkingLevel,
} = useConversationSession();

const hasConversation = computed(() => items.value.length > 0);

/* Temporary front-end data for tuning the Activity card. It sits at the
 * same boundary as the real extension UI payload, so Activity receives
 * the exact wire shape. This is dev-only and does not change the server
 * or WebSocket protocol; remove this block after visual tuning. */
const debugActivityStatuses: Record<string, string> = {
  mcp: "MCP: 5 servers enabled",
  runtime: "Background dispatch active",
};
const debugActivityWidgets: Record<string, { widget: ExtensionWidget; placement: ExtensionWidgetPlacement }> = {
  workflow: {
    placement: "aboveEditor",
    widget: {
      kind: "task-tree",
      runs: [
        {
          id: "debug-scout",
          kind: "workflow",
          label: "Workspace review",
          state: "running",
          activity: { toolCount: 7, currentTool: "grep" },
          children: [
            {
              id: "debug-main",
              kind: "subagent",
              label: "Inspect project structure",
              state: "running",
              activity: { toolCount: 4, currentTool: "fd" },
            },
            {
              id: "debug-tests",
              kind: "step",
              label: "Check existing tests",
              state: "complete",
              activity: { toolCount: 3 },
            },
            {
              id: "debug-next",
              kind: "step",
              label: "Prepare implementation plan",
              state: "queued",
            },
          ],
        },
      ],
    },
  },
  output: {
    placement: "belowEditor",
    widget: {
      kind: "lines",
      lines: ["Indexing workspace files", "Waiting for language server"],
    },
  },
};
/* Preview is opt-in in the current browser only. Normal dev sessions keep
 * consuming real extension data; enable it while tuning with
 * `localStorage.setItem("pichamber.activityPreview", "1")`, then reload. */
const useDebugActivity = import.meta.env.DEV
  && localStorage.getItem("pichamber.activityPreview") === "1";

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
    <ConversationMessages v-if="hasConversation" :items="items" :available-models="availableModels" :show-timestamps="settings.showTimestamps" />
    <h2 v-else>What are we working on in {{ workspace.folderName }}?</h2>

    <UserInputBlock
      v-model="draft"
      v-model:images="images"
      :can-send="canSend"
      :busy="busy"
      :activity="activity"
      :pending="pending"
      :can-restore-pending="canRestorePending"
      :commands="resources.commands"
      :extension-statuses="useDebugActivity ? debugActivityStatuses : extensionUi.statuses"
      :extension-widgets="useDebugActivity ? debugActivityWidgets : extensionUi.widgets"
      :model="model"
      :available-models="availableModels"
      :thinking-level="thinking.level"
      :available-thinking-levels="thinking.availableLevels"
      :send-key="settings.sendKey"
      @send="send"
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
