import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import type { ConversationMessage } from "@pichamber/shared";

export const useConversationSession = (messages: Ref<ConversationMessage[]>) => {
  const draft = ref<string>();
  const connected = ref(false);

  let ws: WsHandle | null = null;
  let activeSessionId: string | null = null;

  const canSend = computed(
    () => connected.value && draft.value != undefined && draft.value.trim().length > 0,
  );

  const appendMessage = (message: ConversationMessage) => {
    messages.value = [...messages.value, message];
  };

  const onStatus = (status: WsStatus) => {
    if (status.type === "ready") {
      connected.value = true;
      messages.value = status.messages ?? [];
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
    try {
      ws = connectSessionWs(
        sessionId,
        (message) => {
          if (activeSessionId === sessionId) appendMessage(message);
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

  return { canSend, connect, disconnect, draft, messages, send };
};
