<script setup lang="ts">
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
import { createSession, listSessions, toMessage } from "@/api/client";
import { connectSessionWs, type SessionEvent, type WsHandle, type WsStatus } from "@/api/ws";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
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

let ws: WsHandle | null = null;
let streamId: string | null = null;

const canSend = computed(() => connected.value && draft.value.trim().length > 0);

// ── Pi AgentSession event stream ──────────────────────────────────────
// Event shapes come from @earendil-works/pi-coding-agent (AgentEvent) and
// @earendil-works/pi-ai (AssistantMessageEvent). Only the text channel is
// rendered in this stage; tool/thinking events are tolerated but ignored.

const onEvent = (event: SessionEvent) => {
  const type = event.type;
  if (type === "message_update") {
    const ae = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
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
};

const beginAssistant = () => {
  streamId = crypto.randomUUID();
  messages.value.push({ id: streamId, role: "assistant", content: "" });
};

const appendDelta = (delta: string) => {
  if (!streamId) beginAssistant();
  const target = streamId ? messages.value.find((m) => m.id === streamId) : undefined;
  if (target) {
    target.content += delta;
  }
};

const endAssistant = () => {
  if (!streamId) return;
  streamId = null;
};

const onStatus = (status: WsStatus) => {
  if (status.type === "ready") {
    connected.value = true;
  } else if (status.type === "error") {
    messages.value.push({ id: crypto.randomUUID(), role: "error", content: status.error });
  } else if (status.type === "closed") {
    connected.value = false;
    endAssistant();
  }
};

// ── Send ──────────────────────────────────────────────────────────────

const send = () => {
  const text = draft.value.trim();
  if (!canSend.value || !ws) return;
  messages.value.push({ id: crypto.randomUUID(), role: "user", content: text });
  ws.send({ type: "prompt", message: text });
  draft.value = "";
};

const usePreset = (label: string) => {
  draft.value = label;
};

const onKeydown = (event: KeyboardEvent) => {
  // Enter sends; Shift+Enter inserts a newline.
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
};

// ── Session + connection lifecycle ────────────────────────────────────

const ensureSession = async () => {
  const sessions = (await listSessions()) as Array<{ id?: string }>;
  const existing = sessions.find((s) => s.id);
  if (existing?.id) return existing.id;
  const created = await createSession(".");
  return created.sessionId;
};

const connect = async () => {
  try {
    const id = await ensureSession();
    ws = connectSessionWs(id, onEvent, onStatus);
  } catch (err) {
    onStatus({ type: "error", error: toMessage(err) });
  }
};

onMounted(() => {
  connect();
});

onBeforeUnmount(() => {
  ws?.close();
  ws = null;
});
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

    <div class="composer">
      <textarea
        v-model="draft"
        class="composer__input"
        placeholder="@ for files/agents; / for commands and skills; ! for shell; # for snippets"
        rows="1"
        @keydown="onKeydown"
      />
      <div class="composer__footer">
        <div class="composer__footer-leading">
          <IconButton size="compact" label="Add attachment"><AddCircleIcon /></IconButton>
          <IconButton size="compact" label="Expand composer"><FullscreenIcon /></IconButton>
          <IconButton size="compact" label="Permissions"><ShieldUserIcon /></IconButton>
          <IconButton size="compact" label="Goal mode"><TargetIcon /></IconButton>
        </div>
        <div class="composer__footer-trailing">
          <div class="composer__models">
            <strong class="model-control"><span class="model-mark">Ƶ</span> Big Pickle</strong>
            <span class="model-control model-mode"><AiAgentIcon class="model-icon" />Build</span>
          </div>
          <IconButton size="compact" label="Dictation"><MicIcon /></IconButton>
          <IconButton size="compact" label="Send" :disabled="!canSend" @click="send">
            <SendIcon />
          </IconButton>
        </div>
      </div>
    </div>

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
.composer {
  display: flex;
  flex-direction: column;
  width: min(100%, 464px);
  overflow: hidden;
  border: 1px solid #dedbd2;
  border-radius: 13px;
}
.conversation--active .composer {
  width: min(100%, 1280px);
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
  color: #747474;
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
  gap: 12px;
}
.model-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 32px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
}
.model-mode {
  color: #718d28;
}
.model-mark {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}
.model-icon {
  color: #718d28;
}
.model-mode :deep(.model-icon) {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
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
