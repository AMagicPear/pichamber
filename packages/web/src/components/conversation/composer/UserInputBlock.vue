<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentActivity, ModelDescriptor, PendingMessages, RuntimeSlashCommand } from "@amagicpear/pichamber-shared";
import type { ExtensionWidget } from "@/composables/extensionWidgets";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AddCircleIcon from "lucide-static/icons/circle-plus.svg";
import SendIcon from "lucide-static/icons/send.svg";
import LayersArrowDownIcon from "lucide-static/icons/layers-arrow-down.svg";
import StopIcon from "lucide-static/icons/square.svg";
import TargetIcon from "lucide-static/icons/target.svg";
import QuestionIcon from "lucide-static/icons/message-circle-question.svg";
import IconButton from "@/components/ui/IconButton.vue";
import ConfirmModal from "@/components/modals/ConfirmModal.vue";
import ComposerSuggestions from "@/components/conversation/composer/ComposerSuggestions.vue";
import ModelSelector from "@/components/ui/ModelSelector.vue";
import ThinkingLevelSelector from "@/components/ui/ThinkingLevelSelector.vue";
import ComposerSurfaceStack from "@/components/conversation/composer/ComposerSurfaceStack.vue";
import ActivityPanel from "@/components/activity/ActivityPanel.vue";
import ActivityToggle from "@/components/activity/ActivityToggle.vue";
import { messageText } from "@/components/conversation/messages/messageContent";
import type { SendKey } from "@/stores/settings";
import { conversation, working, type DraftImage } from "@/stores/workspace";
import { createId } from "@/utils/id";
import AttachmentIcon from "lucide-static/icons/paperclip.svg";
import ImageThumbnail from "@/components/ui/ImageThumbnail.vue";
import { useDictation } from "@/composables/useDictation";
import { pushErrorToast } from "@/stores/extensionUi";
import { MorphIcon } from "morphicons/vue";
import { lucideIcon } from "@/components/ui/morphIcons";

const { t } = useI18n();

const draft = defineModel<string | undefined>({ required: true });
const images = defineModel<DraftImage[]>("images", { required: true });

const emit = defineEmits<{
  send: [behavior?: "steer" | "followUp"];
  abort: [];
  compact: [];
  restorePending: [];
  reopenExtensionInteraction: [];
  selectModel: [model: ModelDescriptor];
  selectThinkingLevel: [level: ThinkingLevel];
}>();

const props = defineProps<{
  canSend: boolean;
  activity: AgentActivity;
  pending: PendingMessages;
  canRestorePending: boolean;
  hasDeferredExtensionInteraction: boolean;
  commands: RuntimeSlashCommand[];
  extensionStatuses: Record<string, string>;
  extensionWidgets: Record<string, { widget: ExtensionWidget; placement: "aboveEditor" | "belowEditor" }>;
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  /** Submit on bare Enter (current default) or on Cmd/Ctrl+Enter. */
  sendKey: SendKey;
}>();

const submitMode = ref<"steer" | "followUp">("steer");
const suggestions = ref<InstanceType<typeof ComposerSuggestions> | null>(null);
const activeSurface = ref<"activity" | "files" | "commands" | null>(null);
const shelfQuery = ref("");
const dragDepth = ref(0);
const isDraggingImage = computed(() => dragDepth.value > 0);
const suggestionMode = computed<"files" | "commands" | null>(() =>
  activeSurface.value === "files" || activeSurface.value === "commands" ? activeSurface.value : null,
);
const closeSurface = () => { activeSurface.value = null; };

const GOAL_COMMAND = "goal";
const GOAL_PREFIX = `/${GOAL_COMMAND} `;
/** Toggle lit by clicking the target icon; flips off the moment the next
 *  message goes out (see `applyGoalPrefix`). The icon stays disabled until
 *  some extension exposes the command, matching how the shelf filters. */
const goalMode = ref(false);
const goalAvailable = computed(() =>
  props.commands.some((command) => command.name === GOAL_COMMAND),
);
const goalLabel = computed(() =>
  goalAvailable.value
    ? (goalMode.value ? t('composer.goalCancel') : t('composer.goalSend'))
    : t('composer.goalRequires'),
);
/** If the extension providing `/goal` goes away mid-session, drop the lit
 *  state so we never silently prepend a prefix the runtime no longer
 *  recognizes. */
watch(goalAvailable, (available) => {
  if (!available) goalMode.value = false;
});

/** Prepend `/goal ` to the outgoing message once, then reset the toggle.
 *  Skips when the draft already starts with the prefix so the user can
 *  type `/goal …` by hand (or pick it from the shelf) without getting
 *  it doubled. Mutates `draft` before emitting `send` so the parent's
 *  send handler reads the prefixed text synchronously — no DOM flash
 *  because Vue batches the change with the subsequent clear. */
const applyGoalPrefix = () => {
  if (!goalMode.value) return;
  const text = draft.value ?? "";
  draft.value = text.startsWith(GOAL_PREFIX) ? text : `${GOAL_PREFIX}${text}`;
  goalMode.value = false;
};

const pendingDictationSend = ref<{ behavior?: "steer" | "followUp" } | null>(null);
const emitSendNow = (behavior?: "steer" | "followUp") => {
  applyGoalPrefix();
  emit("send", behavior);
};

const emitSend = (behavior?: "steer" | "followUp") => {
  if (dictation.listening.value) {
    pendingDictationSend.value = { behavior };
    dictation.stop();
    return;
  }
  emitSendNow(behavior);
};

const compactConfirmOpen = ref(false);

const requestCompact = () => {
  compactConfirmOpen.value = true;
};

const confirmCompact = () => {
  compactConfirmOpen.value = false;
  emit("compact");
};

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_BYTES = 25 * 1024 * 1024;
const supportedImageTypes = new Set<DraftImage["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const hasImageFile = (transfer: DataTransfer | null) =>
  Array.from(transfer?.items ?? []).some((item) =>
    item.kind === "file" && supportedImageTypes.has(item.type as DraftImage["mimeType"]),
  ) || Array.from(transfer?.files ?? [])
    .some((file) => supportedImageTypes.has(file.type as DraftImage["mimeType"]));

const fileData = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const imageAspectRatio = (file: File) => new Promise<number>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image.naturalWidth / image.naturalHeight);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("Could not read image dimensions"));
  };
  image.src = url;
});

const onDragEnter = (event: DragEvent) => {
  if (!hasImageFile(event.dataTransfer)) return;
  dragDepth.value += 1;
};

const onDragLeave = (event: DragEvent) => {
  if (!hasImageFile(event.dataTransfer)) return;
  dragDepth.value = Math.max(0, dragDepth.value - 1);
};

const addImages = async (candidates: File[]) => {
  const remaining = MAX_IMAGES - images.value.length;
  let totalBytes = images.value.reduce((total, image) => total + Math.floor(image.data.length * 3 / 4), 0);
  const files: File[] = [];
  for (const file of candidates) {
    if (
      files.length < remaining &&
      supportedImageTypes.has(file.type as DraftImage["mimeType"]) &&
      file.size <= MAX_IMAGE_BYTES &&
      totalBytes + file.size <= MAX_IMAGES_BYTES
    ) {
      files.push(file);
      totalBytes += file.size;
    }
  }
  const added = await Promise.all(files.map(async (file) => ({
    id: createId(),
    type: "image" as const,
    mimeType: file.type as DraftImage["mimeType"],
    data: await fileData(file),
    aspectRatio: await imageAspectRatio(file).catch(() => 1),
  })));
  images.value = [...images.value, ...added];
};

const onDrop = (event: DragEvent) => {
  dragDepth.value = 0;
  void addImages(Array.from(event.dataTransfer?.files ?? []));
};

const onPaste = (event: ClipboardEvent) => {
  const files = Array.from(event.clipboardData?.items ?? []).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
  if (files.length > 0) void addImages(files);
};

const removeImage = (id: string) => {
  images.value = images.value.filter((image) => image.id !== id);
};

const onKeydown = (event: KeyboardEvent) => {
  if (suggestionMode.value && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    suggestions.value?.move(event.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (activeSurface.value) closeSurface();
    else if (working) emit("abort");
    return;
  }
  if (event.key === "Enter") {
    // Enter is also used to confirm an IME candidate. Do not submit while
    // composition is active; otherwise the IME writes the draft back after
    // the send handler clears it.
    if (event.isComposing || event.keyCode === 229) return;
    // Shift+Enter always inserts a newline regardless of send-key preference;
    // the rest branches on whether the user picked bare Enter or Cmd/Ctrl+Enter.
    const wantsModSend = event.metaKey || event.ctrlKey;
    const shouldSubmit = props.sendKey === "enter"
      ? !event.shiftKey
      : wantsModSend;
    if (!shouldSubmit) return;
    event.preventDefault();
    if (suggestionMode.value) suggestions.value?.choose();
    else emitSend(event.altKey ? "followUp" : submitMode.value);
  }
};

const inputEl = ref<HTMLTextAreaElement | null>(null);

/** Insert text at the caret, restoring focus and caret position. */
const insertAtCursor = (text: string) => {
  const el = inputEl.value;
  const current = draft.value ?? "";
  if (el) {
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? start;
    draft.value = current.slice(0, start) + text + current.slice(end);
    nextTick(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  } else {
    draft.value = current + text;
  }
};

const insertDictation = (text: string) => {
  const current = draft.value ?? "";
  const cursor = inputEl.value?.selectionStart ?? current.length;
  const needsSpace = cursor > 0 && !/\s/.test(current[cursor - 1] ?? "");
  insertAtCursor(`${needsSpace ? " " : ""}${text}`);
};

const dictationError = (code: string) => {
  pushErrorToast(
    code === "not-allowed" || code === "service-not-allowed"
      ? t('composer.dictationPermissionDenied')
      : t('composer.dictationFailed'),
  );
};

const dictation = useDictation(insertDictation, dictationError);
const isDictating = computed(() => dictation.listening.value);
const dictationLabel = computed(() => {
  if (!dictation.supported) return t('composer.dictationUnavailable');
  return isDictating.value ? t('composer.stopDictation') : t('composer.dictation');
});

watch(isDictating, (listening) => {
  if (listening || !pendingDictationSend.value) return;
  const pendingSend = pendingDictationSend.value;
  pendingDictationSend.value = null;
  nextTick(() => {
    if (props.canSend) emitSendNow(pendingSend.behavior);
  });
});

/** One regex for an open `@`/`/` trigger at a token boundary: group 1 is the
 *  leading whitespace (empty at line start), group 2 the trigger char, group 3
 *  the query — bare, or the quoted `@"path with spaces"` form that mirrors
 *  `CombinedAutocompleteProvider.extractAtPrefix`. `triggerStart` is the index
 *  of the trigger char, which `replaceTrigger` uses to splice the pick in. */
const TRIGGER_RE = /(^|\s)([@/])((?:"[^"]*"?)|[^\s]*)$/;

const parseTrigger = (before: string) => {
  const m = TRIGGER_RE.exec(before);
  if (!m) return null;
  const raw = m[3] ?? "";
  const query = raw.startsWith('"') ? raw.slice(1).replace(/"$/, "") : raw;
  return {
    kind: m[2] === "@" ? ("files" as const) : ("commands" as const),
    query,
    triggerStart: m.index + (m[1]?.length ?? 0),
  };
};

const detectTrigger = () => {
  const el = inputEl.value;
  if (!el) {
    if (suggestionMode.value) closeSurface();
    return;
  }
  const trigger = parseTrigger(el.value.slice(0, el.selectionStart));
  if (trigger) {
    activeSurface.value = trigger.kind;
    shelfQuery.value = trigger.query;
  } else if (suggestionMode.value) closeSurface();
};

// Wrap with `"…"` when the path contains whitespace, matching the official
// TUI's `CombinedAutocompleteProvider.buildCompletionValue` (paths-with-spaces
// are emitted as `@"…"`, otherwise the trailing space would split the token).
const atFileToken = (relativePath: string): string =>
  /\s/.test(relativePath) ? `@"${relativePath}"` : `@${relativePath}`;

const onPickFile = (relativePath: string) => {
  replaceTrigger(`${atFileToken(relativePath)} `);
};

const onPickCommand = (command: RuntimeSlashCommand) => {
  replaceTrigger(`/${command.name} `);
};

const replaceTrigger = (replacement: string) => {
  closeSurface();
  const el = inputEl.value;
  const current = draft.value ?? "";
  if (!el) {
    draft.value = current + replacement;
    return;
  }
  const trigger = parseTrigger(el.value.slice(0, el.selectionStart));
  const triggerIndex = trigger ? trigger.triggerStart : el.selectionStart;
  draft.value = el.value.slice(0, triggerIndex) + replacement + el.value.slice(el.selectionStart);
  nextTick(() => {
    el.focus();
    const pos = triggerIndex + replacement.length;
    el.setSelectionRange(pos, pos);
  });
};

const openFiles = () => {
  const el = inputEl.value;
  const current = draft.value ?? "";
  const cursor = el?.selectionStart ?? current.length;
  const needsSpace = cursor > 0 && !/\s/.test(current[cursor - 1] ?? "");
  insertAtCursor(`${needsSpace ? " " : ""}@`);
  activeSurface.value = "files";
  shelfQuery.value = "";
};

const pendingCount = computed(() => props.pending.steering.length + props.pending.followUp.length);
/** 结构化 widget（非 lines）进活动卡片区；lines 走状态脚注（见下）。 */
type CardEntry = {
  widget: Exclude<ExtensionWidget, { kind: "lines" }>;
  placement: "aboveEditor" | "belowEditor";
};
type AuxiliaryItem = {
  id: string;
  source: "status" | "widget-line";
  placement: "aboveEditor" | "belowEditor";
  text: string;
};
const activityWidgets = computed<Record<string, CardEntry>>(() => Object.fromEntries(
  Object.entries(props.extensionWidgets).filter(([, entry]) => entry.widget.kind !== "lines"),
) as Record<string, CardEntry>);
const activityWidgetCount = computed(() => Object.keys(activityWidgets.value).length);
const toggleActivity = () => {
  if (!activityWidgetCount.value) return;
  activeSurface.value = activeSurface.value === "activity" ? null : "activity";
};
const auxiliaryItems = computed<AuxiliaryItem[]>(() => [
  ...Object.entries(props.extensionStatuses).map(([key, text]) => ({
    id: `status:${key}`,
    source: "status" as const,
    placement: "belowEditor" as const,
    text,
  })),
  ...Object.entries(props.extensionWidgets).flatMap(([key, entry]) => entry.widget.kind === "lines"
    ? entry.widget.lines.map((text, index) => ({
      id: `widget:${key}:${index}`,
      source: "widget-line" as const,
      placement: entry.placement,
      text,
    }))
    : [],
  ),
]);

const activityText = computed(() => {
  switch (props.activity.phase) {
    case "working": {
      const detail = workingDetail.value;
      if (detail === "thinking") return t('composer.thinking');
      if (detail === "responding") return t('composer.responding');
      if (detail) return t('composer.runningTool', { tool: detail.tool });
      return t('composer.working');
    }
    case "compacting": return t('composer.compactingContext');
    case "retrying": return t('composer.retrying', { attempt: props.activity.attempt, max: props.activity.maxAttempts });
    default: return t('composer.ready');
  }
});

/** `working` 的细粒度"在干嘛"，照抄 TUI 的做法：indicator 只显示
 *  working，thinking/responding/正在跑工具由消息流组件自己表达——这里从
 *  conversation 列表派生（正在流式的 assistant 消息 / running 工具卡片），
 *  服务端不再把细分塞进 activity。 */
const workingDetail = computed<"thinking" | "responding" | { tool: string } | undefined>(() => {
  const items = conversation.value;
  // 最近一条正在流式的 assistant 消息：已产出文本 → responding，
  // 否则还在 thinking（流式开头 content 只有 thinking part）。
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && item.kind === "message" && item.streaming && item.message.role === "assistant") {
      return messageText(item.message).trim() ? "responding" : "thinking";
    }
  }
  // 正在运行的最后一个工具。
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item && item.kind === "tool" && item.tool.running) return { tool: item.tool.toolName };
  }
  return undefined;
});

/** Placeholder mentions the active submit shortcut so users on the alternative
 *  scheme don't have to dig through Settings. Kept short — the chevron isn't
 *  a full shortcut hint. */
const placeholder = computed(() => {
  const base = t('composer.placeholder');
  return props.sendKey === "enter"
    ? base
    : t('composer.placeholderMod', { base: `${base} ` });
});
</script>

<template>
  <div class="composer-shell">
    <ComposerSurfaceStack :open="activeSurface !== null"
      :show-status="activityWidgetCount > 0 || working || auxiliaryItems.length > 0" @close="closeSurface">
      <template #surface>
        <ActivityPanel v-if="activeSurface === 'activity'" :widgets="activityWidgets" @close="closeSurface" />
        <ComposerSuggestions v-else-if="suggestionMode" ref="suggestions" :mode="suggestionMode ?? 'files'"
          :query="shelfQuery" :commands="commands" @close="closeSurface" @select-file="onPickFile" @select-command="onPickCommand" />
      </template>
      <template #composer>
        <div class="composer"
          :class="{ 'working': working, 'is-dictating': isDictating, 'is-dragging-image': isDraggingImage }"
          @dragenter="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
          <div v-if="isDraggingImage" class="composer__drop-indicator" aria-hidden="true">
            <AttachmentIcon />
          </div>
          <textarea ref="inputEl" v-model="draft" class="composer__input" :placeholder="placeholder" rows="1"
            @input="detectTrigger" @keydown="onKeydown" @click="detectTrigger" @paste="onPaste" />
          <div v-if="isDictating" class="composer__dictation">
            <span class="composer__dictation-wave" aria-hidden="true"><i /><i /><i /></span>
            <span class="composer__dictation-preview" aria-hidden="true">{{ dictation.interimText || t('composer.dictationListening') }}</span>
            <span class="composer__visually-hidden" role="status">{{ t('composer.dictationListening') }}</span>
          </div>
          <div v-if="images.length" class="composer__images" :aria-label="t('composer.attachedImages')">
            <div v-for="image in images" :key="image.id" class="composer__image"
              :style="{ '--image-aspect': image.aspectRatio }">
              <div class="composer__image-content">
                <ImageThumbnail
                  :src="`data:${image.mimeType};base64,${image.data}`"
                  :alt="t('composer.attachedImageAlt')"
                  variant="composer"
                  removable
                  @remove="removeImage(image.id)"
                />
              </div>
            </div>
          </div>
          <div v-if="pendingCount" class="composer__queue">
            <div v-for="(message, index) in pending.steering" :key="`steer:${index}:${message}`">
              <span>{{ t('composer.steerQueue') }}</span>
              <p>{{ message }}</p>
            </div>
            <div v-for="(message, index) in pending.followUp" :key="`follow:${index}:${message}`">
              <span>{{ t('composer.followUpQueue') }}</span>
              <p>{{ message }}</p>
            </div>
            <button v-if="canRestorePending" type="button" @click="emit('restorePending')">{{ t('composer.restoreAll') }}</button>
          </div>
          <div v-if="hasDeferredExtensionInteraction" class="composer__pending-interaction" role="status">
            <QuestionIcon aria-hidden="true" />
            <span>{{ t('extensionUi.waitingForInteraction') }}</span>
            <button type="button" class="composer__pending-interaction-action" @click="emit('reopenExtensionInteraction')">{{ t('extensionUi.openInteraction') }}</button>
          </div>
          <div class="composer__footer">
            <div class="composer__footer-leading">
              <div class="composer__attach">
                <IconButton size="compact" :label="t('composer.attachFiles')" :aria-expanded="activeSurface === 'files'"
                  @click="openFiles">
                  <AddCircleIcon />
                </IconButton>
              </div>
              <!-- Compact works at any time: the SDK's compact() aborts the
               current turn first (same as Pi's /compact), then summarizes. -->
              <IconButton size="compact" :label="t('composer.compactContext')" @click="requestCompact">
                <LayersArrowDownIcon />
              </IconButton>
              <IconButton size="compact" :label="goalLabel" :title="goalLabel" :pressed="goalMode"
                :disabled="!goalAvailable" @click="goalMode = !goalMode">
                <TargetIcon />
              </IconButton>
            </div>
            <div class="composer__footer-trailing">
              <div class="composer__models">
                <ModelSelector :model="model" :available-models="availableModels"
                  @select="emit('selectModel', $event)" />
                <ThinkingLevelSelector :level="thinkingLevel" :available-levels="availableThinkingLevels"
                  @select="emit('selectThinkingLevel', $event)" />
              </div>
              <!-- Mode toggle lives next to the action buttons now that it's
               only meaningful while the agent is busy. -->
              <div v-if="working" class="composer__mode" role="tablist" :aria-label="t('composer.sendMode')">
                <button type="button" role="tab" :aria-selected="submitMode === 'steer'"
                  :class="{ 'is-active': submitMode === 'steer' }" @click="submitMode = 'steer'">{{ t('composer.steer') }}</button>
                <button type="button" role="tab" :aria-selected="submitMode === 'followUp'"
                  :class="{ 'is-active': submitMode === 'followUp' }" @click="submitMode = 'followUp'">{{ t('composer.followUp') }}</button>
              </div>
              <IconButton size="compact" :label="dictationLabel" :pressed="isDictating"
                :tone="isDictating ? 'danger' : undefined" :disabled="!dictation.supported" @click="dictation.toggle">
                <MorphIcon :icon="lucideIcon(isDictating ? 'square' : 'mic')" spring="snappy" reduced-motion="user" />
              </IconButton>
              <IconButton v-if="working" size="compact" :label="t('composer.stopAgent')" tone="danger" @click="emit('abort')">
                <StopIcon />
              </IconButton>
              <IconButton size="compact"
                :label="working ? (submitMode === 'steer' ? t('composer.steerAgent') : t('composer.queueFollowUp')) : t('composer.send')"
                :disabled="!canSend && !isDictating" @click="emitSend(submitMode)">
                <SendIcon />
              </IconButton>
            </div>
          </div>
        </div>
      </template>
      <template #status>
        <ActivityToggle v-if="activityWidgetCount" :count="activityWidgetCount" :expanded="activeSurface === 'activity'" @toggle="toggleActivity" />
        <span v-if="working" class="composer__activity"><i />{{ activityText }}</span>
        <template v-for="(item, index) in auxiliaryItems" :key="item.id">
          <span v-if="working || activityWidgetCount > 0 || index > 0" class="composer__status-sep"
            aria-hidden="true">·</span>
          <span class="composer__status-text" :data-source="item.source">{{ item.text }}</span>
        </template>
      </template>
    </ComposerSurfaceStack>

    <ConfirmModal
      :show="compactConfirmOpen"
      :title="t('composer.compactConfirmTitle')"
      :message="t('composer.compactConfirmMessage')"
      @close="compactConfirmOpen = false"
      @confirm="confirmCompact"
    />
  </div>
</template>

<style scoped>
/* Wrapper owns the horizontal sizing so the composer (bordered) and the
 * status footnote (borderless, outside the box) stay perfectly aligned
 * regardless of which one renders. */
.composer-shell {
  display: flex;
  flex-direction: column;
  width: min(calc(100% - var(--conversation-inline-gutter) - var(--conversation-inline-gutter)),
      var(--conversation-content-width));
}

.composer {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  overflow: visible;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  background: var(--ui-surface);
  z-index: 2;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.composer:focus-within {
  border-color: var(--ui-border-focus);
  box-shadow: 0 2px 12px rgb(35 32 25 / 5%);
}

.composer.working {
  /* Warm neutral border, not blue — keeps the busy state visible without
   * pulling any cool color into the input surface. */
  border-color: #c8bfae;
}

.composer.is-dragging-image {
  border-color: var(--ui-border-focus);
  border-style: dashed;
  box-shadow: 0 0 0 2px var(--ui-focus);
}

.composer.is-dictating:not(.is-dragging-image) {
  border-color: #b65323;
  box-shadow: 0 0 0 2px rgb(182 83 35 / 12%);
  animation: composer-dictation-pulse 1.5s ease-in-out infinite;
}

@keyframes composer-dictation-pulse {
  50% { box-shadow: 0 0 0 4px rgb(182 83 35 / 5%); }
}

.composer__drop-indicator {
  position: absolute;
  z-index: 3;
  inset: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: rgb(83 101 91 / 10%);
  color: var(--ui-text-muted);
  pointer-events: none;
}

.composer__drop-indicator :deep(svg) {
  width: 24px;
  height: 24px;
}

.composer__input {
  display: block;
  flex: 0 0 auto;
  width: 100%;
  min-height: 52px;
  max-height: 204px;
  field-sizing: content;
  box-sizing: border-box;
  padding: 16px 12px 10px;
  border: 0;
  border-radius: 13px 13px 0 0;
  outline: 0;
  overflow-x: hidden;
  overflow-y: auto;
  resize: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1.55;
  background: transparent;
}

.composer__input::placeholder {
  color: var(--ui-text-muted);
}

.composer__dictation {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 12px 7px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.composer__dictation-wave {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  width: 14px;
  height: 14px;
}

.composer__dictation-wave i {
  width: 2px;
  height: 5px;
  border-radius: 2px;
  background: #b65323;
  animation: composer-dictation-wave 700ms ease-in-out infinite alternate;
}

.composer__dictation-wave i:nth-child(2) { height: 11px; animation-delay: 120ms; }
.composer__dictation-wave i:nth-child(3) { height: 7px; animation-delay: 240ms; }

@keyframes composer-dictation-wave {
  to { transform: scaleY(0.45); opacity: 0.55; }
}

.composer__dictation-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.composer__images {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 0 12px 10px;
}

.composer__image {
  width: 42px;
  height: 42px;
  width: min(42px, calc(42px * var(--image-aspect)));
  height: min(42px, calc(42px / var(--image-aspect)));
  animation: composer-image-enter 140ms var(--ui-ease-emphasized) both;
}

.composer__image-content {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 140ms var(--ui-ease-emphasized);
}

@keyframes composer-image-enter {
  from {
    opacity: 0;
    transform: translateY(2px) scale(0.9);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .composer__image:hover .composer__image-content {
    transform: rotate(-1deg) scale(1.04);
  }
}

@media (prefers-reduced-motion: reduce) {
  .composer__image,
  .composer.is-dictating:not(.is-dragging-image),
  .composer__dictation-wave i {
    animation: none;
  }
}

/* Pending messages are separated from the editor by a quiet divider. */
.composer__queue {
  border-top: 1px solid var(--ui-border-subtle);
}

.composer__pending-interaction {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 6px 10px;
  border-top: 1px solid var(--ui-border-subtle);
  background: var(--ui-surface-subtle);
  color: var(--ui-text-strong);
  font-size: 12px;
  line-height: 1.35;
}

.composer__pending-interaction svg {
  width: 16px;
  height: 16px;
  color: var(--ui-status-text);
}

.composer__pending-interaction span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.composer__pending-interaction-action {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-surface);
  color: var(--ui-text-strong);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgb(16 15 15 / 4%);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    color 120ms ease;
}

.composer__pending-interaction-action:hover {
  border-color: #b65323;
  background: var(--ui-surface-hover);
}

.composer__pending-interaction-action:focus-visible {
  outline: 2px solid #b65323;
  outline-offset: 2px;
}

/* Status footnote lives OUTSIDE the composer box — no border, no
 * background, just muted text below the input. The ActivityToggle (its
 * own component) and extension statuses share one wrapping row joined
 * by · so they read as a single quiet phrase rather than separate
 * surfaces. */
.composer__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 5px;
  row-gap: 1px;
  padding: 6px 12px 0 12px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
  position: relative;
  z-index: 1;
}

.composer__status-sep {
  opacity: 0.55;
}

.composer__status-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.composer__activity {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-muted);
  white-space: nowrap;
}

.composer__activity i {
  width: 5px;
  height: 5px;
  flex: 0 0 5px;
  border-radius: 50%;
  background: var(--ui-status-text);
  animation: activity-pulse 1.4s ease-in-out infinite;
}

@keyframes activity-pulse {
  50% {
    opacity: 0.35;
  }
}

/* Pending message queue (steer/follow-up messages waiting to flush). */
.composer__queue {
  display: grid;
  gap: 3px;
  padding: 6px 9px;
}

.composer__queue>div {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: baseline;
  gap: 7px;
  min-height: 23px;
  padding: 3px 5px;
  border-radius: 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.composer__queue>div span {
  color: var(--ui-status-text);
  font-weight: 600;
}

.composer__queue>div p {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer__queue>button {
  justify-self: end;
  padding: 3px 6px;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

/* Footer: leading actions, trailing actions (model + thinking + mode +
 * send/stop). The trailing block uses `flex: 1 1 auto; min-width: 0;` so
 * the model/thinking pills can shrink before they push the action
 * buttons off-screen. */
.composer__footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px 6px 10px;
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

/* Mode toggle (busy-only): sits next to the action buttons so its meaning
 * ("this is how your next message goes") is obvious. Slimmer than the
 * previous segmented control so it doesn't compete with the icons. */
.composer__mode {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: 24px;
  padding: 2px;
  border-radius: 7px;
  background: var(--ui-surface-selected);
  margin-left: 2px;
}

.composer__mode button {
  height: 20px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.composer__mode button.is-active {
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-control);
  color: var(--ui-text-strong);
}
</style>
