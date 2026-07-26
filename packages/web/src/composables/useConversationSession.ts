import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createSession, listSessions, toMessage } from "@/api/client";
import { connectSessionWs, type SessionEvent, type WsHandle, type WsStatus } from "@/api/ws";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
}

// ── Pi AgentSession event stream ──────────────────────────────────────
// Event shapes come from @earendil-works/pi-coding-agent (AgentEvent) and
// @earendil-works/pi-ai (AssistantMessageEvent). Only the text channel is
// rendered in this stage; tool/thinking events are tolerated but ignored.

export const useConversationSession = () => {
  const messages = ref<ConversationMessage[]>([]);
  const draft = ref("");
  const connected = ref(false);

  let ws: WsHandle | null = null;
  let streamId: string | null = null;

  const canSend = computed(() => connected.value && draft.value.trim().length > 0);

  const beginAssistant = () => {
    streamId = crypto.randomUUID();
    messages.value.push({ id: streamId, role: "assistant", content: "" });
  };

  const appendDelta = (delta: string) => {
    if (!streamId) beginAssistant();
    const target = streamId ? messages.value.find((m) => m.id === streamId) : undefined;
    if (target) target.content += delta;
  };

  const endAssistant = () => {
    if (!streamId) return;
    streamId = null;
  };

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

  onMounted(connect);

  onBeforeUnmount(() => {
    ws?.close();
    ws = null;
  });

  return { messages, draft, connected, canSend, send, usePreset };
};