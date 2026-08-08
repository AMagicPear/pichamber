import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import type {
  ConversationTranscriptMessage,
  LiveConversationState,
  ModelDescriptor,
  ThinkingState,
} from "@pichamber/shared";

export const useConversationSession = (entries: Ref<ConversationTranscriptMessage[]>) => {
  const draft = ref<string>();
  const connected = ref(false);
  const live = ref<LiveConversationState>({ pendingUserMessages: [], toolExecutions: [] });
  /** Empty until the server confirms available models in `ready`/`model_state`. */
  const availableModels = ref<ModelDescriptor[]>([]);
  const model = ref<ModelDescriptor | undefined>();
  const thinking = ref<ThinkingState>({ level: "off", availableLevels: ["off"] });

  let ws: WsHandle | null = null;
  let activeSessionId: string | null = null;

  const applyModelState = (snapshot: {
    model?: ModelDescriptor;
    availableModels: ModelDescriptor[];
    thinking: ThinkingState;
  }) => {
    model.value = snapshot.model;
    availableModels.value = snapshot.availableModels;
    thinking.value = snapshot.thinking;
  };

  const canSend = computed(
    () => connected.value && draft.value != undefined && draft.value.trim().length > 0,
  );

  const onStatus = (status: WsStatus) => {
    if (status.type === "ready") {
      connected.value = true;
      entries.value = status.messages ?? [];
      live.value = status.live ?? { pendingUserMessages: [], toolExecutions: [] };
      if (status.thinking) {
        applyModelState({
          model: status.model,
          availableModels: status.availableModels ?? [],
          thinking: status.thinking,
        });
      }
    } else if (status.type === "model_state") {
      applyModelState(status);
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

  /** Optimistically swap the current model on the client. The server's
   *  `model_state` broadcast either confirms the change or surfaces the
   *  error — in both cases we reconcile on the next push. */
  const setModel = (next: ModelDescriptor) => {
    model.value = next;
    ws?.send({ type: "set_model", provider: next.provider, modelId: next.id });
  };

  const setThinkingLevel = (level: ThinkingLevel) => {
    thinking.value = { ...thinking.value, level };
    ws?.send({ type: "set_thinking_level", level });
  };

  const disconnect = () => {
    ws?.close();
    ws = null;
    activeSessionId = null;
    connected.value = false;
    model.value = undefined;
    availableModels.value = [];
    thinking.value = { level: "off", availableLevels: ["off"] };
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

  return {
    availableModels,
    canSend,
    connect,
    disconnect,
    draft,
    entries,
    live,
    model,
    send,
    setModel,
    setThinkingLevel,
    thinking,
  };
};
