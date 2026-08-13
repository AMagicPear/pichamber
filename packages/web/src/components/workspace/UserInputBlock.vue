<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentActivity, ModelDescriptor, PendingMessages, SlashCommandInfo } from "@pichamber/shared";
import { computed, nextTick, ref } from "vue";
import AddCircleIcon from "@/assets/icons/AddCircle.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import MicIcon from "@/assets/icons/Mic.svg";
import CloseIcon from "@/assets/icons/Close.svg";
import SendIcon from "@/assets/icons/SendPlane2.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";
import ComposerShelf from "@/components/workspace/ComposerShelf.vue";
import ModelSelector from "@/components/workspace/ModelSelector.vue";
import ThinkingLevelSelector from "@/components/workspace/ThinkingLevelSelector.vue";

const draft = defineModel<string | undefined>({ required: true });

const emit = defineEmits<{
  send: [behavior?: "steer" | "followUp"];
  abort: [];
  restorePending: [];
  selectModel: [model: ModelDescriptor];
  selectThinkingLevel: [level: ThinkingLevel];
}>();

const props = defineProps<{
  canSend: boolean;
  busy: boolean;
  activity: AgentActivity;
  pending: PendingMessages;
  commands: SlashCommandInfo[];
  extensionStatuses: Record<string, string>;
  extensionWidgets: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
}>();

const submitMode = ref<"steer" | "followUp">("steer");
const shelf = ref<InstanceType<typeof ComposerShelf> | null>(null);
const shelfMode = ref<"files" | "commands" | null>(null);
const shelfQuery = ref("");

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
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (shelfMode.value) shelf.value?.choose();
    else emit("send", props.busy ? (event.altKey ? "followUp" : submitMode.value) : undefined);
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

const detectTrigger = () => {
  const el = inputEl.value;
  if (!el) {
    shelfMode.value = null;
    return;
  }
  const before = el.value.slice(0, el.selectionStart);
  const m = /(^|\s)([@/])([^\s]*)$/.exec(before);
  if (m) {
    shelfMode.value = m[2] === "@" ? "files" : "commands";
    shelfQuery.value = m[3] ?? "";
  } else shelfMode.value = null;
};

const onPickFile = (relativePath: string) => {
  replaceTrigger(`@${relativePath} `);
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
  const before = el.value.slice(0, el.selectionStart);
  const m = /(^|\s)([@/])([^\s]*)$/.exec(before);
  const triggerIndex = m ? m.index + m[1]!.length : el.selectionStart;
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
const activityText = computed(() => {
  switch (props.activity.phase) {
    case "thinking": return "Thinking";
    case "responding": return "Responding";
    case "tool": return `Running ${props.activity.toolName}`;
    case "compacting": return "Compacting context";
    case "retrying": return `Retrying ${props.activity.attempt}/${props.activity.maxAttempts}`;
    default: return "Ready";
  }
});

const aboveWidgets = computed(() => Object.values(props.extensionWidgets).filter((widget) => widget.placement === "aboveEditor"));
const belowWidgets = computed(() => Object.values(props.extensionWidgets).filter((widget) => widget.placement === "belowEditor"));
</script>

<template>
  <div class="composer" :class="{ 'is-busy': busy, 'has-shelf': shelfMode }">
    <ComposerShelf
      ref="shelf"
      :mode="shelfMode"
      :query="shelfQuery"
      :commands="commands"
      @select-file="onPickFile"
      @select-command="onPickCommand"
    />
    <div v-for="(widget, index) in aboveWidgets" :key="`above:${index}`" class="composer__widget">
      <span v-for="(line, lineIndex) in widget.lines" :key="lineIndex">{{ line }}</span>
    </div>
    <textarea
      ref="inputEl"
      v-model="draft"
      class="composer__input"
      placeholder="Ask Pi anything. Type @ for files or / for commands."
      rows="1"
      @input="detectTrigger"
      @keydown="onKeydown"
      @click="detectTrigger"
    />
    <div v-if="busy || pendingCount || Object.keys(extensionStatuses).length" class="composer__status">
      <span v-if="busy" class="composer__activity"><i />{{ activityText }}</span>
      <span v-for="(text, key) in extensionStatuses" :key="key" class="composer__extension-status">{{ text }}</span>
      <div v-if="busy" class="composer__delivery" aria-label="Message delivery">
        <button type="button" :class="{ 'is-active': submitMode === 'steer' }" @click="submitMode = 'steer'">Steer</button>
        <button type="button" :class="{ 'is-active': submitMode === 'followUp' }" @click="submitMode = 'followUp'">Follow up</button>
      </div>
      <IconButton v-if="busy" size="compact" label="Stop agent" @click="emit('abort')"><CloseIcon /></IconButton>
    </div>
    <div v-if="pendingCount" class="composer__queue">
      <div v-for="(message, index) in pending.steering" :key="`steer:${index}:${message}`">
        <span>Steer</span><p>{{ message }}</p>
      </div>
      <div v-for="(message, index) in pending.followUp" :key="`follow:${index}:${message}`">
        <span>Follow up</span><p>{{ message }}</p>
      </div>
      <button type="button" @click="emit('restorePending')">Restore all</button>
    </div>
    <div v-for="(widget, index) in belowWidgets" :key="`below:${index}`" class="composer__widget">
      <span v-for="(line, lineIndex) in widget.lines" :key="lineIndex">{{ line }}</span>
    </div>
    <div class="composer__footer">
      <div class="composer__footer-leading">
        <div class="composer__attach">
          <IconButton size="compact" label="Attach files" :aria-expanded="shelfMode === 'files'" @click="openFiles">
            <AddCircleIcon />
          </IconButton>
        </div>
        <IconButton size="compact" label="Expand composer" disabled><FullscreenIcon /></IconButton>
        <IconButton size="compact" label="Goal mode" disabled><TargetIcon /></IconButton>
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
        <IconButton size="compact" label="Dictation" disabled><MicIcon /></IconButton>
        <IconButton size="compact" :label="busy ? (submitMode === 'steer' ? 'Steer agent' : 'Queue follow-up') : 'Send'" :disabled="!canSend" @click="emit('send', busy ? submitMode : undefined)">
          <SendIcon />
        </IconButton>
      </div>
    </div>
  </div>

</template>

<style scoped>
.composer {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(
    calc(100% - var(--conversation-inline-gutter) - var(--conversation-inline-gutter)),
    var(--conversation-content-width)
  );
  overflow: visible;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  background: var(--ui-surface);
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.composer:focus-within {
  border-color: var(--ui-border-focus);
  box-shadow: 0 2px 12px rgb(35 32 25 / 5%);
}
.composer.is-busy {
  border-color: #b9c5d3;
}
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
  color: var(--ui-text-muted);
}
.composer__status,
.composer__queue,
.composer__widget {
  border-top: 1px solid var(--ui-border-subtle);
}
.composer__status {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 10px;
  padding: 4px 9px 4px 12px;
  color: var(--ui-text-muted);
  font-size: 11px;
}
.composer__activity {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  color: #4d5f72;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer__activity i {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #5d7895;
  animation: activity-pulse 1.2s ease-in-out infinite;
}
@keyframes activity-pulse {
  50% { opacity: 0.35; transform: scale(0.78); }
}
.composer__extension-status {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer__delivery {
  display: inline-flex;
  height: 24px;
  margin-left: auto;
  padding: 2px;
  border-radius: 6px;
  background: var(--ui-surface-selected);
}
.composer__delivery button {
  padding: 0 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  cursor: pointer;
}
.composer__delivery button.is-active {
  background: var(--ui-surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
  color: var(--ui-text-strong);
}
.composer__widget {
  display: grid;
  gap: 2px;
  padding: 7px 12px;
  background: var(--ui-surface-subtle);
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
}
.composer__queue {
  display: grid;
  gap: 3px;
  padding: 6px 9px;
  background: var(--ui-surface-subtle);
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
.composer__queue > div span { color: #4f6478; font-weight: 600; }
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
@media (prefers-reduced-motion: reduce) {
  .composer__activity i { animation: none; }
}
</style>
