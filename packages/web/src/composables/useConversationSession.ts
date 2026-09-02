import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PromptOptions, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { onBeforeUnmount } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import { matchBuiltinCommand } from "./builtin-commands";
import { extensionUi, pushErrorToast, settleExtensionInteraction } from "@/stores/extensionUi";
import {
  applyServerMessage,
  connected,
  draft,
  images,
  resetSessionState,
} from "@/stores/session";
import { applySessionEffects } from "@/stores/sessionEffects";
import { createId } from "@/utils/id";
import { getDiagnostics } from "@/diagnostics/browser-events";
import type { ClientMessage, ModelDescriptor, ServerMessage, TrackedOperation } from "@amagicpear/pichamber-shared";

/* ── WS 生命周期与协议动作 ─────────────────────────────────────────
 *  这里不定义任何会话状态 —— 所有会话状态与事件应用都在
 *  `@/stores/session`（reducer）与 `@/stores/extensionUi`（扩展 UI）。本模块
 *  只负责：WebSocket 生命周期、帧传输，以及把用户动作翻译成 WS 帧。动作
 *  签名对齐官方 `AgentSession`（prompt/abort/compact/setModel/
 *  setThinkingLevel…）。只取数据的组件请直接 import session store，不需要
 *  调用本 composable。
 * ─────────────────────────────────────────────────────────────────── */

let ws: WsHandle<ClientMessage> | null = null;
let activeSessionId: string | null = null;
let streamUpdateFrame: number | undefined;
let pendingStreamUpdates: ServerMessage[] = [];

/** Number of components currently subscribed via the composable. The
 *  WebSocket only opens when the first one mounts and only closes when
 *  the last one unmounts, so a passive reader can't tear down the live
 *  connection ConversationPanel depends on. */
let refCount = 0;

const applyMessage = (message: ServerMessage) => {
  void recordSessionMessage(message);
  applySessionEffects(applyServerMessage(message, () => ws?.send({ type: "resync" })));
};

const isAssistantDelta = (message: ServerMessage) =>
  message.type === "message_update" && !("message" in message);

/** Vue batches synchronous mutations into one render. Buffer token-level
 * deltas until the next paint so Markdown parsing, layout and scroll work run
 * at most once per frame, while preserving the protocol's event order. */
const flushStreamUpdates = () => {
  if (streamUpdateFrame !== undefined) {
    window.cancelAnimationFrame(streamUpdateFrame);
    streamUpdateFrame = undefined;
  }
  const updates = pendingStreamUpdates;
  pendingStreamUpdates = [];
  for (const update of updates) applyMessage(update);
};

const scheduleStreamUpdateFlush = () => {
  if (streamUpdateFrame !== undefined) return;
  streamUpdateFrame = window.requestAnimationFrame(() => {
    streamUpdateFrame = undefined;
    const updates = pendingStreamUpdates;
    pendingStreamUpdates = [];
    for (const update of updates) applyMessage(update);
  });
};

const discardStreamUpdates = () => {
  if (streamUpdateFrame !== undefined) window.cancelAnimationFrame(streamUpdateFrame);
  streamUpdateFrame = undefined;
  pendingStreamUpdates = [];
};

const onMessage = (message: ServerMessage) => {
  if (isAssistantDelta(message)) {
    pendingStreamUpdates.push(message);
    scheduleStreamUpdateFlush();
    return;
  }
  // A terminal event/snapshot may arrive before the next animation frame.
  // Apply its preceding deltas first so it cannot overwrite partial content.
  flushStreamUpdates();
  applyMessage(message);
};

const onStatus = (status: WsStatus) => {
  switch (status.type) {
    case "closed":
      connected.value = false;
      void recordWebEvent({
        level: "warn",
        scope: "web.ws",
        msg: "WebSocket closed",
        extra: { code: status.code ?? null, reason: status.reason ?? null },
      });
      break;
    case "error":
      pushErrorToast(status.error);
      void recordWebEvent({
        level: "error",
        scope: "web.ws",
        msg: status.error,
      });
      break;
  }
};

/** Records key wire-level events into the browser diagnostics ring. The
 *  Promise never rejects — a missing IndexedDB just means the event is
 *  dropped. */
const recordWebEvent = async (event: Parameters<Awaited<ReturnType<typeof getDiagnostics>>["record"]>[0]) => {
  try {
    const handle = await getDiagnostics();
    handle.record({ ...event, ...(activeSessionId ? { sessionId: activeSessionId } : {}) });
  } catch {
    /* swallow */
  }
};

/** Observe operation_result frames so the browser can correlate user intent
 *  with server outcome even when the operation changes session state via
 *  separate broadcasts. */
const recordSessionMessage = async (message: ServerMessage) => {
  if (message.type !== "operation_result") return;
  void recordWebEvent({
    level: message.ok ? "info" : "error",
    scope: "web.operation",
    msg: `${message.operation} ${message.ok ? "applied" : "failed"}`,
    operationId: message.operationId,
    ...(message.ok ? { extra: { applied: message.applied } } : { extra: { error: message.error } }),
  });
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

const abort = () => sendTracked("abort", (operationId) => ({ type: "abort", restorePending: true, operationId }));
/** 对齐官方 `clearQueue()` 的语义：把排队消息取回输入框（服务器发
 *  `draft_restore` 帧）。 */
const restorePending = () => ws?.send({ type: "restore_pending" });
const compact = (customInstructions?: string) =>
  sendTracked("compact", (operationId) => ({ type: "compact", customInstructions, operationId }));
/** Reload extensions, prompts, themes, and context files — mirrors the
 *  TUI's `/reload`. The server guards against streaming/compaction. */
const reload = () => sendTracked("reload", (operationId) => ({ type: "reload", operationId }));

const respondToExtension = (response: RpcExtensionUIResponse) => {
  ws?.send(response);
  settleExtensionInteraction(response.id);
};

/** Pi owns the model and thinking state. Wait for its state broadcast
 *  instead of guessing locally: setModel can fail after the user selects a
 *  model (for example when auth has just expired). */
const setModel = (next: ModelDescriptor) =>
  sendTracked("set_model", (operationId) => ({
    type: "set_model",
    provider: next.provider,
    modelId: next.id,
    operationId,
  }));

const setThinkingLevel = (level: ThinkingLevel) =>
  sendTracked("set_thinking_level", (operationId) => ({
    type: "set_thinking_level",
    level,
    operationId,
  }));

/** Send a state-mutating command with a fresh correlation id and log the
 *  user intent. The matching `operation_result` from the server is logged
 *  separately so the pair appears as "intent" → "applied|failed" in the
 *  browser's diagnostics ring. */
const sendTracked = (operation: TrackedOperation, build: (operationId: string) => ClientMessage) => {
  if (!ws) return;
  const operationId = createId();
  void recordWebEvent({
    level: "info",
    scope: "web.operation",
    msg: `${operation} requested`,
    operationId,
  });
  ws.send(build(operationId));
};

const disconnect = () => {
  discardStreamUpdates();
  ws?.close();
  ws = null;
  activeSessionId = null;
  resetSessionState();
};

const connect = (sessionId: string) => {
  if (activeSessionId === sessionId) return;
  disconnect();
  activeSessionId = sessionId;
  void recordWebEvent({
    level: "info",
    scope: "web.ws",
    msg: "WebSocket connecting",
  });
  try {
    ws = connectSessionWs(sessionId, onMessage, onStatus, () => {
      void recordWebEvent({
        level: "info",
        scope: "web.ws",
        msg: "WebSocket open",
      });
    });
  } catch (error) {
    pushErrorToast(toMessage(error));
  }
};

/** Returns the composable's actions (WS lifecycle + protocol verbs). The
 *  conversation state itself lives in `@/stores/session` — components that
 *  only read data import it directly instead of calling this. */
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
