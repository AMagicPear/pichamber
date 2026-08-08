import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import type { ConversationTranscriptMessage, LiveConversationState } from "@pichamber/shared";

export const useConversationSession = (entries: Ref<ConversationTranscriptMessage[]>) => {
  const draft = ref<string>();
  const connected = ref(false);
  const live = ref<LiveConversationState>({ pendingUserMessages: [], toolExecutions: [] });

  let ws: WsHandle | null = null;
  let activeSessionId: string | null = null;

  const canSend = computed(
    () => connected.value && draft.value != undefined && draft.value.trim().length > 0,
  );

  const onStatus = (status: WsStatus) => {
    if (status.type === "ready") {
      connected.value = true;
      entries.value = status.messages ?? [];
      live.value = status.live ?? { pendingUserMessages: [], toolExecutions: [] };
    } else if (status.type === "closed") {
      connected.value = false;
    }
  };

  const send = () => {
    const text = draft.value?.trim();
    if (!canSend.value || !ws || !text) return;
    ws.send({ type: "prompt", message: text });
    draft.value = undefined;
  };

  const disconnect = () => {
    ws?.close();
    ws = null;
    activeSessionId = null;
    connected.value = false;
  };

  const connect = (sessionId: string) => {
    if (activeSessionId === sessionId) return;
    disconnect();
    activeSessionId = sessionId;
    entries.value = [];
    live.value = { pendingUserMessages: [], toolExecutions: [] };
    try {
      ws = connectSessionWs(
        sessionId,
        (message) => {
          if (activeSessionId !== sessionId) return;
          if (message.type === "messages") {
            entries.value = message.messages;
          } else {
            live.value = message.live;
          }
        },
        (status) => {
          if (activeSessionId === sessionId) onStatus(status);
        },
      );
    } catch (error) {
      onStatus({ type: "error", error: toMessage(error) });
    }
  };

  onBeforeUnmount(disconnect);

  return { canSend, connect, disconnect, draft, entries, live, send };
};
