import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import { refreshSessions } from "@/stores/workspace";
import type {
  ConversationTranscriptMessage,
  LiveConversationState,
  ModelDescriptor,
  ThinkingState,
} from "@pichamber/shared";

export const useConversationSession = (entries: Ref<ConversationTranscriptMessage[]>) => {
  const draft = ref<string>();
  const connected = ref(false);
  const live = ref<LiveConversationState>({ pendingUserMessages: [], toolExecutions: [], busy: false });
  /** Empty until the server confirms available models in `ready`/`model_state`. */
  const availableModels = ref<ModelDescriptor[]>([]);
  const model = ref<ModelDescriptor | undefined>();
  const thinking = ref<ThinkingState>({ level: "off", availableLevels: ["off"] });
  /** Most recent server-pushed error message (transport / invalid model /
   *  invalid thinking level / catastrophic prompt failure). Cleared when
   *  the user dismisses it, the next prompt sends, or the session drops. */
  const lastError = ref<string | null>(null);

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
      live.value = status.live ?? { pendingUserMessages: [], toolExecutions: [], busy: false };
      lastError.value = null;
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
    } else if (status.type === "error") {
      lastError.value = status.error;
    }
  };

  const send = () => {
    const text = draft.value?.trim();
    if (!canSend.value || !ws || !text) return;
    // Clear any previous error so the toast doesn't linger into the next turn.
    lastError.value = null;
    ws.send({ type: "prompt", message: text });
    draft.value = undefined;
  };

  /** Pi owns the model and thinking state. Wait for its model_state broadcast
   *  instead of guessing locally: setModel can fail after the user selects a
   *  model (for example when auth has just expired). */
  const setModel = (next: ModelDescriptor) => {
    ws?.send({ type: "set_model", provider: next.provider, modelId: next.id });
  };

  const setThinkingLevel = (level: ThinkingLevel) => {
    thinking.value = { ...thinking.value, level };
    ws?.send({ type: "set_thinking_level", level });
  };

  const dismissError = () => {
    lastError.value = null;
  };

  const disconnect = () => {
    ws?.close();
    ws = null;
    activeSessionId = null;
    connected.value = false;
    model.value = undefined;
    availableModels.value = [];
    thinking.value = { level: "off", availableLevels: ["off"] };
    lastError.value = null;
  };

  const connect = (sessionId: string) => {
    if (activeSessionId === sessionId) return;
    disconnect();
    activeSessionId = sessionId;
    entries.value = [];
    live.value = { pendingUserMessages: [], toolExecutions: [], busy: false };
    try {
      ws = connectSessionWs(
        sessionId,
        (message) => {
          if (activeSessionId !== sessionId) return;
          if (message.type === "messages") {
            entries.value = message.messages;
          } else {
            live.value = message.live;
            // The server marks the run idle only once, on agent_settled —
            // that's the signal that the session file changed and the
            // sidebar needs a refresh. (Mid-run lulls are busy, so this
            // can't fire spuriously between tool events.)
            if (!message.live.busy) {
              void refreshSessions();
            }
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
    dismissError,
    draft,
    entries,
    lastError,
    live,
    model,
    send,
    setModel,
    setThinkingLevel,
    thinking,
  };
};
