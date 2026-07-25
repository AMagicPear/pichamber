<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import AddIcon from "@/assets/icons/Add.svg";
import AddCircleIcon from "@/assets/icons/AddCircle.svg";
import AiAgentIcon from "@/assets/icons/AiAgent.svg";
import BugIcon from "@/assets/icons/Bug.svg";
import CompassIcon from "@/assets/icons/Compass3.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import HistoryIcon from "@/assets/icons/History.svg";
import MicIcon from "@/assets/icons/Mic.svg";
import ScalesIcon from "@/assets/icons/Scales3.svg";
import SearchEyeIcon from "@/assets/icons/SearchEye.svg";
import SendIcon from "@/assets/icons/SendPlane2.svg";
import ShieldUserIcon from "@/assets/icons/ShieldUser.svg";
import SurveyIcon from "@/assets/icons/Survey.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";
import { createSession, listSessions } from "@/api/client";
import { connectWs, type SessionEvent, type SessionStatus, type WsHandle } from "@/api/ws";

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  streaming?: boolean;
}

const presets = [
  { label: "Explore the codebase", icon: CompassIcon },
  { label: "Catch me up", icon: HistoryIcon },
  { label: "Weigh my options", icon: ScalesIcon },
  { label: "Start feature planning", icon: SurveyIcon },
  { label: "Craft a Goal", icon: TargetIcon },
  { label: "Debug an issue", icon: BugIcon },
  { label: "Review my changes", icon: SearchEyeIcon },
];

const messages = ref<Message[]>([]);
const draft = ref("");
const connected = ref(false);
const connecting = ref(false);
const sessionId = ref<string | null>(null);

let ws: WsHandle | null = null;
let streamId: string | null = null;

const hasMessages = computed(() => messages.value.length > 0);
const canSend = computed(
  () => connected.value && !connecting.value && draft.value.trim().length > 0,
);

// ── Pi AgentSession event stream ──────────────────────────────────────
// Event shapes come from @earendil-works/pi-coding-agent (AgentEvent) and
// @earendil-works/pi-ai (AssistantMessageEvent). Only the text channel is
// rendered in this stage; tool/thinking events are tolerated but ignored.

function onEvent(event: SessionEvent): void {
  const type = event.type;
  if (type === "message_update") {
    const ae = event.assistantMessageEvent as
      | { type?: string; delta?: string }
      | undefined;
    if (ae?.type === "text_delta" && typeof ae.delta === "string") {
      appendDelta(ae.delta);
    }
  } else if (type === "message_start") {
    // Pi echoes every message as message_start — including the user's.
    // Only open an assistant bubble for assistant messages.
    const msg = event.message as { role?: string } | undefined;
    if (msg?.role === "assistant") beginAssistant();
  } else if (type === "message_end" || type === "turn_end") {
    endAssistant();
  }
}

function beginAssistant(): void {
  streamId = crypto.randomUUID();
  messages.value.push({ id: streamId, role: "assistant", content: "", streaming: true });
  scrollDown();
}

function appendDelta(delta: string): void {
  if (!streamId) beginAssistant();
  const target = streamId ? messages.value.find((m) => m.id === streamId) : undefined;
  if (target) {
    target.content += delta;
    scrollDown();
  }
}

function endAssistant(): void {
  if (!streamId) return;
  const target = messages.value.find((m) => m.id === streamId);
  if (target) target.streaming = false;
  streamId = null;
}

function onStatus(status: SessionStatus): void {
  if (status.type === "ready") {
    connected.value = true;
    connecting.value = false;
  } else if (status.type === "error") {
    connecting.value = false;
    messages.value.push({ id: crypto.randomUUID(), role: "error", content: status.error });
    scrollDown();
  } else if (status.type === "closed") {
    connected.value = false;
    endAssistant();
  }
}

// ── Send ──────────────────────────────────────────────────────────────

function send(): void {
  const text = draft.value.trim();
  if (!canSend.value || !ws) return;
  messages.value.push({ id: crypto.randomUUID(), role: "user", content: text });
  ws.send({ type: "prompt", message: text });
  draft.value = "";
  scrollDown();
}

function usePreset(label: string): void {
  draft.value = label;
}

function onKeydown(event: KeyboardEvent): void {
  // Enter sends; Shift+Enter inserts a newline.
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
}

function scrollDown(): void {
  void nextTick(() => {
    const el = document.querySelector(".conversation__messages");
    if (el) el.scrollTop = el.scrollHeight;
  });
}

// ── Session + connection lifecycle ────────────────────────────────────

async function ensureSession(): Promise<string> {
  const sessions = (await listSessions()) as Array<{ id?: string }>;
  const existing = sessions.find((s) => s.id);
  if (existing?.id) return existing.id;
  const created = await createSession(".");
  return created.sessionId;
}

async function connect(): Promise<void> {
  try {
    connecting.value = true;
    sessionId.value = await ensureSession();
  } catch (err) {
    onStatus({ type: "error", error: err instanceof Error ? err.message : String(err) });
    return;
  }
  ws = connectWs(sessionId.value, onEvent, onStatus);
}

onMounted(() => {
  void connect();
});

onBeforeUnmount(() => {
  ws?.close();
  ws = null;
});
</script>

<template>
  <main class="conversation">
    <div v-if="hasMessages" class="conversation__messages">
      <div
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="`message--${message.role}`"
      >
        <span class="message__role">{{ message.role }}</span>
        <p class="message__content">{{ message.content }}</p>
      </div>
    </div>
    <h2 v-else>What are we working<br />on in amagicpear?</h2>

    <div class="composer">
      <textarea
        v-model="draft"
        class="composer__input"
        placeholder="Use @ / ! # for helpers"
        rows="2"
        :disabled="connecting"
        @keydown="onKeydown"
      />
      <div class="composer__footer">
        <IconButton size="compact" label="Add attachment"><AddCircleIcon /></IconButton>
        <IconButton size="compact" label="Expand composer"><FullscreenIcon /></IconButton>
        <IconButton size="compact" label="Permissions"><ShieldUserIcon /></IconButton>
        <IconButton size="compact" label="Goal mode"><TargetIcon /></IconButton>
        <IconButton size="compact" label="Model options"
          ><AiAgentIcon class="model-icon"
        /></IconButton>
        <IconButton size="compact" label="Dictation"><MicIcon /></IconButton>
        <IconButton size="compact" label="Send" :disabled="!canSend" @click="send">
          <SendIcon />
        </IconButton>
      </div>
    </div>

    <div v-if="!hasMessages" class="presets" aria-label="Prompt starters">
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
  padding: 24px 24px 16px;
  overflow: hidden;
}
.conversation__messages {
  flex: 1 1 auto;
  width: min(100%, 768px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  padding: 4px 0;
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
.message__role {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9a9a9a;
}
.message__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 20px;
}
.composer {
  width: min(100%, 464px);
  padding: 18px 12px 12px;
  border: 1px solid #dedbd2;
  border-radius: 13px;
  margin: 0;
}
.composer__input {
  width: 100%;
  border: 0;
  outline: 0;
  resize: none;
  margin: 0 0 12px;
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  line-height: 20px;
  background: transparent;
}
.composer__input::placeholder {
  color: #747474;
}
.composer__input:disabled {
  opacity: 0.6;
}
.composer__footer {
  display: flex;
  align-items: center;
  gap: 3px;
}
.composer__footer strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.model-mark {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}
.model-icon {
  color: #718d28;
}
.presets {
  display: flex;
  width: min(100%, 500px);
  justify-content: center;
  gap: 7px;
  flex-wrap: wrap;
  margin: 0;
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
</style>
