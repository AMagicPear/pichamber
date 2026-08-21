import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PromptOptions, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { onBeforeUnmount } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import { matchBuiltinCommand } from "./builtin-commands";
import { extensionUi, pushErrorToast, showNextExtensionDialog } from "@/stores/extensionUi";
import {
  applyServerMessage,
  connected,
  draft,
  images,
  resetSessionState,
  thinking,
} from "@/stores/workspace";
import type { ModelDescriptor, ServerMessage } from "@amagicpear/pichamber-shared";

/* ── WS 生命周期与协议动作 ─────────────────────────────────────────
 *  这里不定义任何会话状态 —— 所有会话状态与事件应用都在
 *  `@/stores/workspace`（模块级 store）。本模块只负责：WebSocket 生命周期、
 *  帧传输，以及把用户动作翻译成 WS 帧。动作签名对齐官方 `AgentSession`
 *  （prompt/abort/compact/setModel/setThinkingLevel…）。只取数据的组件请
 *  直接 import workspace store，不需要调用本 composable。
 * ─────────────────────────────────────────────────────────────────── */

let ws: WsHandle | null = null;
let activeSessionId: string | null = null;

/** Number of components currently subscribed via the composable. The
 *  WebSocket only opens when the first one mounts and only closes when
 *  the last one unmounts, so a passive reader can't tear down the live
 *  connection ConversationPanel depends on. */
let refCount = 0;

const onMessage = (message: ServerMessage) => {
  applyServerMessage(message, () => ws?.send({ type: "resync" }));
};

const onStatus = (status: WsStatus) => {
  switch (status.type) {
    case "closed":
      connected.value = false;
      break;
    case "error":
      pushErrorToast(status.error);
      break;
  }
};

/** 对齐官方 `AgentSession.prompt(text, options?)`：`options` 直接复用官方
 *  `PromptOptions`（streamingBehavior / images 语义一致）。 */
const prompt = (text: string, options?: PromptOptions) => {
  const content = text.trim();
  if (!connected.value || (!content && images.value.length === 0) || !ws) return;
  // Dismiss any lingering error toasts so they don't pile up across turns.
  extensionUi.notifications = extensionUi.notifications.filter((n) => n.type !== "error");
  // Built-in slash commands route to their dedicated WS frames instead of
  // leaving the client as a `prompt` message (see `builtin-commands.ts`).
  const builtin = matchBuiltinCommand(content);
  switch (builtin?.name) {
    case "compact":
      compact(builtin.customInstructions ?? undefined);
      break;
    case "reload":
      reload();
      break;
    default:
      ws.send({
        type: "prompt",
        message: content,
        images: images.value.map(({ data, mimeType }) => ({ type: "image", data, mimeType })),
        streamingBehavior: options?.streamingBehavior,
      });
  }
  draft.value = undefined;
  images.value = [];
};

const abort = () => ws?.send({ type: "abort", restorePending: true });
/** 对齐官方 `clearQueue()` 的语义：把排队消息取回输入框（服务器发
 *  `draft_restore` 帧）。 */
const restorePending = () => ws?.send({ type: "restore_pending" });
const compact = (customInstructions?: string) => ws?.send({ type: "compact", customInstructions });
/** Reload extensions, prompts, themes, and context files — mirrors the
 *  TUI's `/reload`. The server guards against streaming/compaction. */
const reload = () => ws?.send({ type: "reload" });

const respondToExtension = (response: RpcExtensionUIResponse) => {
  ws?.send({ type: "ui_response", response });
  showNextExtensionDialog();
};

/** Pi owns the model and thinking state. Wait for its state broadcast
 *  instead of guessing locally: setModel can fail after the user selects a
 *  model (for example when auth has just expired). */
const setModel = (next: ModelDescriptor) => {
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
  resetSessionState();
};

const connect = (sessionId: string) => {
  if (activeSessionId === sessionId) return;
  disconnect();
  activeSessionId = sessionId;
  try {
    ws = connectSessionWs(sessionId, onMessage, onStatus);
  } catch (error) {
    pushErrorToast(toMessage(error));
  }
};

/** Returns the composable's actions (WS lifecycle + protocol verbs). The
 *  conversation state itself lives in `@/stores/workspace` — components
 *  that only read data import it directly instead of calling this. */
export const useConversationSession = () => {
  refCount += 1;
  onBeforeUnmount(() => {
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      disconnect();
    }
  });

  return {
    abort,
    compact,
    connect,
    disconnect,
    prompt,
    reload,
    respondToExtension,
    restorePending,
    setModel,
    setThinkingLevel,
  };
};
