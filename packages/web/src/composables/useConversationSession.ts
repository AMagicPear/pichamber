import { computed, onBeforeUnmount, ref } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type AgentSessionEvent, type WsHandle, type WsStatus } from "@/api/ws";

// ── Pi AgentSession event stream ──────────────────────────────────────
// Event shapes come from @earendil-works/pi-coding-agent (AgentEvent) and
// @earendil-works/pi-ai (AssistantMessageEvent). Only the text channel is
// rendered in this stage; tool/thinking events are tolerated but ignored.

export const useConversationSession = () => {
  const draft = ref<string>();
  const connected = ref(false);

  let ws: WsHandle | null = null;
  let streamId: string | null = null;

  const canSend = computed(
    () => connected.value && draft.value != undefined && draft.value.trim().length > 0,
  );
  const endAssistant = () => {
    if (!streamId) return;
    streamId = null;
  };

  const onEvent = (event: AgentSessionEvent) => {
    const type = event.type;
    if (type === "message_update") {
      const ae = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (ae?.type === "text_delta" && typeof ae.delta === "string") {
      }
    } else if (type === "message_start") {
    } else if (type === "message_end" || type === "turn_end") {
    }
  };

  const onStatus = (status: WsStatus) => {
    if (status.type === "ready") {
      connected.value = true;
    } else if (status.type === "error") {
    } else if (status.type === "closed") {
      connected.value = false;
      endAssistant();
    }
  };

  const send = () => {
    const text = draft.value?.trim();
    if (!canSend.value || !ws || !text) return;
    ws.send({ type: "prompt", message: text });
    draft.value = undefined;
  };

  const connect = async (sessionId: string) => {
    try {
      ws = connectSessionWs(sessionId, onEvent, onStatus);
    } catch (err) {
      onStatus({ type: "error", error: toMessage(err) });
    }
  };

  onBeforeUnmount(() => {
    ws?.close();
    ws = null;
  });

  return { draft, connected, canSend, send, connect };
};
