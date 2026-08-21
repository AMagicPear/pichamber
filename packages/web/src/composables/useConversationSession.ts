import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";
import { onBeforeUnmount } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import { matchBuiltinCommand } from "./builtin-commands";
import { refreshSessions } from "@/stores/workspace";
import {
  activity,
  availableModels,
  busy,
  canRestorePending,
  connected,
  draft,
  extensionUi,
  images,
  items,
  model,
  pending,
  resources,
  stats,
  thinking,
  windowTitle,
} from "@/stores/workspace";
import { settings } from "@/stores/settings";
import type {
  ModelDescriptor,
  ServerMessage,
  WebExtensionUIRequest,
} from "@amagicpear/pichamber-shared";

/* ── WS 生命周期与协议动作 ─────────────────────────────────────────
 *  这里不定义任何状态 —— 所有会话状态都在 `@/stores/workspace`（模块级
 *  store）。本模块只负责：WebSocket 生命周期、消息处理、以及把用户
 *  动作翻译成 WS 帧。只取数据的组件请直接 import workspace store，
 *  不需要调用本 composable。
 * ─────────────────────────────────────────────────────────────────── */

type ExtensionDialog = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

const extensionDialogQueue: ExtensionDialog[] = [];

const showNextExtensionDialog = () => {
  extensionUi.dialog = extensionDialogQueue.shift() ?? null;
};

/** Push a transport / model / thinking / catastrophic-prompt error onto the
 *  shared toast queue. The toast auto-dismisses after 5s and can be closed
 *  manually, matching the lifecycle of extension notifications. */
const pushErrorToast = (message: string) => {
  const id = `error-${crypto.randomUUID()}`;
  extensionUi.notifications.push({ id, message, type: "error" });
  setTimeout(() => dismissNotification(id), 5_000);
};

let ws: WsHandle | null = null;
let activeSessionId: string | null = null;

/** 已应用的广播序号；发现间隙就请求 resync（快照会重置）。 */
let lastSeq = 0;
let resyncPending = false;

/** Number of components currently subscribed via the composable. The
 *  WebSocket only opens when the first one mounts and only closes when
 *  the last one unmounts, so a passive reader can't tear down the live
 *  connection ConversationPanel depends on. */
let refCount = 0;

/** 按 id 原地 upsert：顺序即服务器推送顺序，流式增长/阶段翻转都只改内容。 */
const requestResync = () => {
  if (resyncPending) return;
  resyncPending = true;
  ws?.send({ type: "resync" });
};

const handleUiRequest = (request: WebExtensionUIRequest) => {
  switch (request.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      if (extensionUi.dialog) extensionDialogQueue.push(request);
      else extensionUi.dialog = request;
      break;
    case "notify":
      extensionUi.notifications.push({
        id: request.id,
        message: request.message,
        type: request.notifyType ?? "info",
      });
      setTimeout(() => dismissNotification(request.id), 5_000);
      break;
    case "setStatus":
      if (request.statusText) extensionUi.statuses[request.statusKey] = request.statusText;
      else delete extensionUi.statuses[request.statusKey];
      break;
    case "setWidget":
      if (request.widget) {
        extensionUi.widgets[request.widgetKey] = {
          widget: request.widget,
          placement: request.widgetPlacement ?? "aboveEditor",
        };
      } else delete extensionUi.widgets[request.widgetKey];
      break;
    case "setTitle":
      windowTitle.value = request.title || undefined;
      break;
    case "set_editor_text":
      draft.value = request.text;
      break;
  }
};

const onMessage = (message: ServerMessage) => {
  switch (message.type) {
    case "snapshot": {
      resyncPending = false;
      connected.value = true;
      items.value = message.items;
      busy.value = message.busy;
      activity.value = message.activity;
      pending.value = message.pending;
      canRestorePending.value = message.canRestorePending;
      lastSeq = message.seq;
      if ("model" in message) model.value = message.model;
      if (message.availableModels) availableModels.value = message.availableModels;
      if (message.thinking) thinking.value = message.thinking;
      if (message.stats) stats.value = message.stats;
      resources.value = message.resources;
      break;
    }
    case "item": {
      if (message.seq !== lastSeq + 1) {
        requestResync();
        break;
      }
      lastSeq = message.seq;
      const item = message.item;
      const index = items.value.findIndex((i) => i.id === item.id);
      // shallowRef 不追踪数组内部变更，upsert 后整条重写触发渲染。
      if (index === -1) items.value = [...items.value, item];
      else items.value = items.value.map((i) => (i.id === item.id ? item : i));
      break;
    }
    case "state": {
      if (message.seq !== lastSeq + 1) {
        requestResync();
        break;
      }
      lastSeq = message.seq;
      if (message.busy !== undefined) busy.value = message.busy;
      if (message.activity) activity.value = message.activity;
      if (message.pending) pending.value = message.pending;
      if (message.resources) resources.value = message.resources;
      if ("model" in message) model.value = message.model;
      if (message.availableModels) availableModels.value = message.availableModels;
      if (message.thinking) thinking.value = message.thinking;
      if (message.stats) stats.value = message.stats;
      // 服务器只在 agent_settled / compaction_end 广播 busy=false
      // 回合跑完刷新侧栏 + 完成通知。disconnect 的本地翻转不经过这里，不会误响。
      if (message.busy === false) {
        void refreshSessions();
        notifyAgentSettled();
      }
      break;
    }
    case "ui_request":
      handleUiRequest(message.request);
      break;
    case "draft_restore":
      draft.value = [...message.messages, draft.value?.trim()].filter(Boolean).join("\n\n");
      break;
    case "error":
      pushErrorToast(message.error);
      break;
  }
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

const send = (streamingBehavior?: "steer" | "followUp") => {
  const text = draft.value?.trim();
  if (!connected.value || (!text && images.value.length === 0) || !ws) return;
  // Dismiss any lingering error toasts so they don't pile up across turns.
  extensionUi.notifications = extensionUi.notifications.filter((n) => n.type !== "error");
  // Built-in slash commands route to their dedicated WS frames instead of
  // leaving the client as a `prompt` message (see `builtin-commands.ts`).
  const builtin = matchBuiltinCommand(text ?? "");
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
        message: text ?? "",
        images: images.value.map(({ type, data, mimeType }) => ({ type, data, mimeType })),
        streamingBehavior,
      });
  }
  draft.value = undefined;
  images.value = [];
};

const abort = () => ws?.send({ type: "abort", restorePending: true });
const restorePending = () => ws?.send({ type: "restore_pending" });
const compact = (customInstructions?: string) => ws?.send({ type: "compact", customInstructions });
/** Reload extensions, prompts, themes, and context files — mirrors the
 *  TUI's `/reload`. The server guards against streaming/compaction. */
const reload = () => ws?.send({ type: "reload" });

const respondToExtension = (response: RpcExtensionUIResponse) => {
  ws?.send({ type: "ui_response", response });
  showNextExtensionDialog();
};

const dismissNotification = (id: string) => {
  const index = extensionUi.notifications.findIndex((notification) => notification.id === id);
  if (index !== -1) extensionUi.notifications.splice(index, 1);
};

// ─── Turn-completion notifications ──────────────────────────────────
//
// Fired directly from the `state` handler when the server broadcasts
// `busy: false` (agent_settled / compaction_end). Disconnect flips busy
// locally without a server frame, so session swaps never ping.

// Short Web Audio two-note "ding-dong". Most browsers suspend an
// AudioContext until a user gesture, so the very first settle after page
// load may stay silent — that's by design and matches every other
// browser-based agent UI.
const playCompletionChime = () => {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const schedule = (t: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    };
    const t0 = ctx.currentTime + 0.005;
    schedule(t0, 880, 0.18);
    schedule(t0 + 0.09, 1320, 0.16);
    if (ctx.state === "suspended") void ctx.resume();
    setTimeout(() => {
      ctx.close().catch(() => undefined);
    }, 400);
  } catch {
    /* users who block audio context get nothing — totally fine */
  }
};

const fireDesktopNotification = (modelLabel: string) => {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const body = modelLabel ? `${modelLabel} finished responding.` : "Agent finished responding.";
    const notification = new Notification("Pichamber", {
      body,
      silent: true,
      tag: "pichamber-completion",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    setTimeout(() => notification.close(), 7_000);
  } catch {
    /* some browsers throw when fired too often in quick succession */
  }
};

const notifyAgentSettled = () => {
  if (settings.notifySound) playCompletionChime();
  if (settings.notifyDesktop) {
    const label = model.value?.name?.trim() || model.value?.id || model.value?.provider || "";
    fireDesktopNotification(label);
  }
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
  connected.value = false;
  items.value = [];
  images.value = [];
  busy.value = false;
  activity.value = { phase: "idle" };
  pending.value = { steering: [], followUp: [] };
  canRestorePending.value = true;
  resources.value = {
    commands: [],
    tools: [],
    extensions: [],
    diagnostics: [],
    extensionInventoryAvailable: false,
  };
  extensionUi.dialog = null;
  extensionDialogQueue.splice(0);
  extensionUi.notifications.splice(0);
  for (const key of Object.keys(extensionUi.statuses)) delete extensionUi.statuses[key];
  for (const key of Object.keys(extensionUi.widgets)) delete extensionUi.widgets[key];
  windowTitle.value = undefined;
  model.value = undefined;
  availableModels.value = [];
  thinking.value = { level: "off", availableLevels: ["off"] };
  stats.value = undefined;
  lastSeq = 0;
  resyncPending = false;
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
    dismissNotification,
    reload,
    respondToExtension,
    restorePending,
    send,
    setModel,
    setThinkingLevel,
  };
};
