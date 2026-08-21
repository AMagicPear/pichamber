import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import { matchBuiltinCommand } from "./builtin-commands";
import { refreshSessions, workspace } from "@/stores/workspace";
import { settings } from "@/stores/settings";
import type {
  LiveItem,
  AgentActivity,
  ExtensionWidget,
  ExtensionWidgetPlacement,
  ModelDescriptor,
  PendingMessages,
  PromptImage,
  RuntimeResources,
  ServerMessage,
  SessionStatsView,
  ThinkingState,
  WebExtensionUIRequest,
} from "@amagicpear/pichamber-shared";

/* ── Module-level state ─────────────────────────────────────────────
 *  Lives outside the composable so multiple components (the
 *  Conversation panel that owns the input + WebSocket lifecycle, and
 *  the Context pane that just renders the stats view) see the same
 *  refs. Mirrors the `workspace` / `ui` pattern: module-level reactive
 *  export, no Pinia, no provide/inject.
 * ─────────────────────────────────────────────────────────────────── */
const draft = ref<string>();
export type DraftImage = PromptImage & { id: string; aspectRatio: number };
const images = ref<DraftImage[]>([]);
const connected = ref(false);

/** 统一 item 流：服务器铸造的稳定 id 终生不变，live→committed 只翻字段。
 *  shallowRef：流由服务器整体替换/整条重写，避免 ref 的 UnwrapRef 在
 *  递归的 LiveItem 上深层展开（TS2589）。 */
const items = shallowRef<LiveItem[]>([]);
const busy = ref(false);
const activity = ref<AgentActivity>({ phase: "idle" });
const pending = ref<PendingMessages>({ steering: [], followUp: [] });
const canRestorePending = ref(true);
const resources = ref<RuntimeResources>({
  commands: [],
  tools: [],
  extensions: [],
  diagnostics: [],
  extensionInventoryAvailable: false,
});
type ExtensionDialog = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;
type ExtensionNotification = { id: string; message: string; type: "info" | "warning" | "error" };
type WidgetEntry = { widget: ExtensionWidget; placement: ExtensionWidgetPlacement };

const extensionUi = reactive({
  dialog: null as ExtensionDialog | null,
  notifications: [] as ExtensionNotification[],
  statuses: {} as Record<string, string>,
  widgets: {} as Record<string, WidgetEntry>,
});
const extensionDialogQueue: ExtensionDialog[] = [];

const showNextExtensionDialog = () => {
  extensionUi.dialog = extensionDialogQueue.shift() ?? null;
};
/** Empty until the server confirms available models in `snapshot`/`state`. */
const availableModels = ref<ModelDescriptor[]>([]);
const model = ref<ModelDescriptor | undefined>();
/** Mirror the active model into the shared `workspace` store so views
 *  outside the conversation panel (header quota chip, account badge, …)
 *  see the same provider/model without subscribing to the WS themselves.
 *  Runs at module scope so the mirror is always live, independent of how
 *  many components currently call `useConversationSession`. */
watch(model, (next) => {
  workspace.currentModel = next;
});
const thinking = ref<ThinkingState>({ level: "off", availableLevels: ["off"] });
/** Pre-formatted Context-pane view; the server is the source of truth. */
const stats = ref<SessionStatsView | undefined>();
/** Terminal window/tab title set by extensions via `ctx.ui.setTitle()`.
 *  This is a per-session host-window title (the pi protocol's
 *  `setTitle`), NOT the browser tab title — it must never touch
 *  `document.title`. Displayed by SessionHeader, which falls back to
 *  `workspace.sessionName` when no extension title is set. */
const windowTitle = ref<string | undefined>();
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
 *  the last one unmounts, so the Context pane (a passive reader) can't
 *  tear down the live connection ConversationPanel depends on. */
let refCount = 0;

const applyModelState = (snapshot: {
  model?: ModelDescriptor;
  availableModels?: ModelDescriptor[];
  thinking?: ThinkingState;
  stats?: SessionStatsView;
}) => {
  if ("model" in snapshot) model.value = snapshot.model;
  if (snapshot.availableModels) availableModels.value = snapshot.availableModels;
  if (snapshot.thinking) thinking.value = snapshot.thinking;
  if (snapshot.stats) stats.value = snapshot.stats;
};

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
      applyModelState(message);
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
      applyModelState(message);
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

const canSend = computed(
  () => connected.value && (Boolean(draft.value?.trim()) || images.value.length > 0),
);

const send = (streamingBehavior?: "steer" | "followUp") => {
  const text = draft.value?.trim();
  if (!canSend.value || !ws) return;
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

/** Returns the shared refs and API. The first call increments the
 *  refcount but does not touch the WebSocket — lifecycle is driven by
 *  the caller's `watch(workspace.sessionId)`. Subsequent calls (e.g.
 *  the Context pane) just attach to the same state. The last unmount
 *  disconnects to keep a clean shutdown if ConversationPanel itself
 *  unmounts without a session switch. */
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
    availableModels,
    abort,
    activity,
    busy,
    canRestorePending,
    canSend,
    compact,
    connect,
    connected,
    disconnect,
    dismissNotification,
    draft,
    items,
    model,
    pending,
    resources,
    extensionUi,
    images,
    respondToExtension,
    restorePending,
    reload,
    send,
    setModel,
    setThinkingLevel,
    stats,
    thinking,
    windowTitle,
  };
};
