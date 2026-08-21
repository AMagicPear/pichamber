<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentActivity, ExtensionWidget, ModelDescriptor, PendingMessages, SlashCommandInfo } from "@amagicpear/pichamber-shared";
import { computed, nextTick, ref, watch } from "vue";
import AddCircleIcon from "@/assets/icons/AddCircle.svg";
import MicIcon from "@/assets/icons/Mic.svg";
import SendIcon from "@/assets/icons/SendPlane2.svg";
import StackIcon from "@/assets/icons/Stack.svg";
import StopIcon from "@/assets/icons/Stop.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";
import ComposerShelf from "@/components/workspace/ComposerShelf.vue";
import ModelSelector from "@/components/workspace/ModelSelector.vue";
import ThinkingLevelSelector from "@/components/workspace/ThinkingLevelSelector.vue";
import ComposerActivityStack from "@/components/workspace/ComposerActivityStack.vue";
import { messageText } from "@/components/workspace/messageContent";
import type { SendKey } from "@/stores/settings";
import { conversation, type DraftImage } from "@/stores/workspace";
import AttachmentIcon from "@/assets/icons/Attachment2.svg";
import CloseIcon from "@/assets/icons/Close.svg";

const draft = defineModel<string | undefined>({ required: true });
const images = defineModel<DraftImage[]>("images", { required: true });

const emit = defineEmits<{
  send: [behavior?: "steer" | "followUp"];
  abort: [];
  compact: [];
  restorePending: [];
  selectModel: [model: ModelDescriptor];
  selectThinkingLevel: [level: ThinkingLevel];
}>();

const props = defineProps<{
  canSend: boolean;
  busy: boolean;
  activity: AgentActivity;
  pending: PendingMessages;
  canRestorePending: boolean;
  commands: SlashCommandInfo[];
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
const shelf = ref<InstanceType<typeof ComposerShelf> | null>(null);
const shelfMode = ref<"files" | "commands" | null>(null);
const shelfQuery = ref("");
const dragDepth = ref(0);
const isDraggingImage = computed(() => dragDepth.value > 0);

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
    ? (goalMode.value ? "Cancel /goal prefix" : "Send next message as /goal")
    : "Goal mode (requires an extension that provides /goal)",
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

const emitSend = (behavior?: "steer" | "followUp") => {
  applyGoalPrefix();
  emit("send", behavior);
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
    id: crypto.randomUUID(),
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
  if (shelfMode.value && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    shelf.value?.move(event.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (shelfMode.value) shelfMode.value = null;
    else if (props.busy) emit("abort");
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
    if (shelfMode.value) shelf.value?.choose();
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
    shelfMode.value = null;
    return;
  }
  const trigger = parseTrigger(el.value.slice(0, el.selectionStart));
  if (trigger) {
    shelfMode.value = trigger.kind;
    shelfQuery.value = trigger.query;
  } else shelfMode.value = null;
};

// Wrap with `"…"` when the path contains whitespace, matching the official
// TUI's `CombinedAutocompleteProvider.buildCompletionValue` (paths-with-spaces
// are emitted as `@"…"`, otherwise the trailing space would split the token).
const atFileToken = (relativePath: string): string =>
  /\s/.test(relativePath) ? `@"${relativePath}"` : `@${relativePath}`;

const onPickFile = (relativePath: string) => {
  replaceTrigger(`${atFileToken(relativePath)} `);
};

const onPickCommand = (command: SlashCommandInfo) => {
  replaceTrigger(`/${command.name} `);
};

const replaceTrigger = (replacement: string) => {
  shelfMode.value = null;
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
  shelfMode.value = "files";
  shelfQuery.value = "";
};

const pendingCount = computed(() => props.pending.steering.length + props.pending.followUp.length);
type TaskTreeEntry = {
  widget: Extract<ExtensionWidget, { kind: "task-tree" }>;
  placement: "aboveEditor" | "belowEditor";
};
type AuxiliaryItem = {
  id: string;
  source: "status" | "widget-line";
  placement: "aboveEditor" | "belowEditor";
  text: string;
};
const activityWidgets = computed<Record<string, TaskTreeEntry>>(() => Object.fromEntries(
  Object.entries(props.extensionWidgets).filter(([, entry]) => entry.widget.kind === "task-tree"),
) as Record<string, TaskTreeEntry>);
const activityWidgetCount = computed(() => Object.keys(activityWidgets.value).length);
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
      if (detail === "thinking") return "Thinking";
      if (detail === "responding") return "Responding";
      if (detail) return `Running ${detail.tool}`;
      return "Working";
    }
    case "compacting": return "Compacting context";
    case "retrying": return `Retrying ${props.activity.attempt}/${props.activity.maxAttempts}`;
    default: return "Ready";
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
  const base = "Ask Pi anything. Type @ for files or / for commands.";
  return props.sendKey === "enter"
    ? base
    : `${base} Submit with ⌘/Ctrl + Enter.`;
});
</script>

<template>
  <div class="composer-shell">
    <ComposerActivityStack
      :widgets="activityWidgets"
      :show-status="busy || auxiliaryItems.length > 0"
    >
      <template #composer>
      <div
        class="composer"
        :class="{ 'is-busy': busy, 'has-shelf': !!shelfMode, 'is-dragging-image': isDraggingImage }"
        @dragenter="onDragEnter"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
      <ComposerShelf
        ref="shelf"
        :mode="shelfMode"
        :query="shelfQuery"
        :commands="commands"
        @select-file="onPickFile"
        @select-command="onPickCommand"
      />
      <div v-if="isDraggingImage" class="composer__drop-indicator" aria-hidden="true"><AttachmentIcon /></div>
      <textarea
        ref="inputEl"
        v-model="draft"
        class="composer__input"
        :placeholder="placeholder"
        rows="1"
        @input="detectTrigger"
        @keydown="onKeydown"
        @click="detectTrigger"
        @paste="onPaste"
      />
      <div v-if="images.length" class="composer__images" aria-label="Attached images">
        <div v-for="image in images" :key="image.id" class="composer__image" :style="{ '--image-aspect': image.aspectRatio }">
          <div class="composer__image-content">
            <img :src="`data:${image.mimeType};base64,${image.data}`" alt="Attached image" />
            <button type="button" aria-label="Remove image" title="Remove image" @click="removeImage(image.id)"><CloseIcon /></button>
          </div>
        </div>
      </div>
      <div v-if="pendingCount" class="composer__queue">
        <div v-for="(message, index) in pending.steering" :key="`steer:${index}:${message}`">
          <span>Steer</span><p>{{ message }}</p>
        </div>
        <div v-for="(message, index) in pending.followUp" :key="`follow:${index}:${message}`">
          <span>Follow up</span><p>{{ message }}</p>
        </div>
        <button v-if="canRestorePending" type="button" @click="emit('restorePending')">Restore all</button>
      </div>
      <div class="composer__footer">
        <div class="composer__footer-leading">
          <div class="composer__attach">
            <IconButton size="compact" label="Attach files" :aria-expanded="shelfMode === 'files'" @click="openFiles">
              <AddCircleIcon />
            </IconButton>
          </div>
          <!-- Compact works at any time: the SDK's compact() aborts the
               current turn first (same as Pi's /compact), then summarizes. -->
          <IconButton size="compact" label="Compact context" @click="emit('compact')"><StackIcon /></IconButton>
          <IconButton
            size="compact"
            :label="goalLabel"
            :title="goalLabel"
            :pressed="goalMode"
            :disabled="!goalAvailable"
            @click="goalMode = !goalMode"
          ><TargetIcon /></IconButton>
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
          <!-- Mode toggle lives next to the action buttons now that it's
               only meaningful while the agent is busy. -->
          <div v-if="busy" class="composer__mode" role="tablist" aria-label="Send mode">
            <button
              type="button"
              role="tab"
              :aria-selected="submitMode === 'steer'"
              :class="{ 'is-active': submitMode === 'steer' }"
              @click="submitMode = 'steer'"
            >Steer</button>
            <button
              type="button"
              role="tab"
              :aria-selected="submitMode === 'followUp'"
              :class="{ 'is-active': submitMode === 'followUp' }"
              @click="submitMode = 'followUp'"
            >Follow up</button>
          </div>
          <IconButton size="compact" label="Dictation" disabled><MicIcon /></IconButton>
          <IconButton
            v-if="busy"
            size="compact"
            label="Stop agent"
            tone="danger"
            @click="emit('abort')"
          ><StopIcon /></IconButton>
          <IconButton
            size="compact"
            :label="busy ? (submitMode === 'steer' ? 'Steer agent' : 'Queue follow-up') : 'Send'"
            :disabled="!canSend"
            @click="emitSend(submitMode)"
          ><SendIcon /></IconButton>
        </div>
      </div>
      </div>
      </template>
      <template #status>
        <span v-if="busy" class="composer__activity"><i />{{ activityText }}</span>
        <template v-for="(item, index) in auxiliaryItems" :key="item.id">
          <span v-if="busy || activityWidgetCount > 0 || index > 0" class="composer__status-sep" aria-hidden="true">·</span>
          <span class="composer__status-text" :data-source="item.source">{{ item.text }}</span>
        </template>
      </template>
    </ComposerActivityStack>
  </div>
</template>

<style scoped>
/* Wrapper owns the horizontal sizing so the composer (bordered) and the
 * status footnote (borderless, outside the box) stay perfectly aligned
 * regardless of which one renders. */
.composer-shell {
  display: flex;
  flex-direction: column;
  width: min(
    calc(100% - var(--conversation-inline-gutter) - var(--conversation-inline-gutter)),
    var(--conversation-content-width)
  );
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
.composer.is-busy {
  /* Warm neutral border, not blue — keeps the busy state visible without
   * pulling any cool color into the input surface. */
  border-color: #c8bfae;
}
.composer.is-dragging-image {
  border-color: var(--ui-border-focus);
  border-style: dashed;
  box-shadow: 0 0 0 2px var(--ui-focus);
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
.composer__drop-indicator :deep(svg) { width: 24px; height: 24px; }
.composer.has-shelf {
  border-radius: 0 0 13px 13px;
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
.composer__image img {
  display: block;
  width: 100%;
  height: 100%;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  object-fit: cover;
}
.composer__image button {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-flex;
  width: 15px;
  height: 15px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  background: var(--ui-surface);
  color: var(--ui-text-muted);
  cursor: pointer;
}
.composer__image button:hover { color: var(--ui-text-strong); background: var(--ui-surface-hover); }
.composer__image button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 1px; }
.composer__image button :deep(svg) { width: 10px; height: 10px; }
@keyframes composer-image-enter {
  from { opacity: 0; transform: translateY(2px) scale(0.9); }
  to { opacity: 1; transform: none; }
}
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .composer__image:has(img:hover) .composer__image-content { transform: rotate(-1deg) scale(1.04); }
}
@media (prefers-reduced-motion: reduce) {
  .composer__image { animation: none; }
}

/* Pending messages are separated from the editor by a quiet divider. */
.composer__queue {
  border-top: 1px solid var(--ui-border-subtle);
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
  50% { opacity: 0.35; }
}

/* Pending message queue (steer/follow-up messages waiting to flush). */
.composer__queue {
  display: grid;
  gap: 3px;
  padding: 6px 9px;
}
.composer__queue > div {
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
.composer__queue > div span { color: var(--ui-status-text); font-weight: 600; }
.composer__queue > div p { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer__queue > button {
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
