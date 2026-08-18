import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import { refreshSessions, workspace } from "@/stores/workspace";
import type {
  LiveItem,
  AgentActivity,
  ModelDescriptor,
  PendingMessages,
  RuntimeResources,
  ServerMessage,
  SessionStatsView,
  ThinkingState,
} from "@pichamber/shared";

/* ── Module-level state ─────────────────────────────────────────────
 *  Lives outside the composable so multiple components (the
 *  Conversation panel that owns the input + WebSocket lifecycle, and
 *  the Context pane that just renders the stats view) see the same
 *  refs. Mirrors the `workspace` / `ui` pattern: module-level reactive
 *  export, no Pinia, no provide/inject.
 * ─────────────────────────────────────────────────────────────────── */
const draft = ref<string>();
const connected = ref(false);
/** 统一 item 流：服务器铸造的稳定 id 终生不变，live→committed 只翻字段。 */
const items = ref<LiveItem[]>([]);
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
const extensionUi = reactive({
  dialog: null as
    | Extract<
        import("@earendil-works/pi-coding-agent").RpcExtensionUIRequest,
        { method: "select" | "confirm" | "input" | "editor" }
      >
    | null,
  notifications: [] as Array<{
    id: string;
    message: string;
    type: "info" | "warning" | "error";
  }>,
  statuses: {} as Record<string, string>,
  widgets: {} as Record<
    string,
    { lines: string[]; placement: "aboveEditor" | "belowEditor" }
  >,
});
const extensionDialogQueue: Array<NonNullable<typeof extensionUi.dialog>> = [];

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
const applyItem = (item: LiveItem) => {
  const index = items.value.findIndex((i) => i.id === item.id);
  if (index === -1) items.value.push(item);
  else items.value[index] = item;
};

const requestResync = () => {
  if (resyncPending) return;
  resyncPending = true;
  ws?.send({ type: "resync" });
};

const onMessage = (message: ServerMessage) => {
  if (message.type === "snapshot") {
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
  } else if (message.type === "item") {
    if (message.seq !== lastSeq + 1) {
      requestResync();
      return;
    }
    lastSeq = message.seq;
    applyItem(message.item);
  } else if (message.type === "state") {
    if (message.seq !== lastSeq + 1) {
      requestResync();
      return;
    }
    lastSeq = message.seq;
    if (message.busy !== undefined) busy.value = message.busy;
    if (message.activity) activity.value = message.activity;
    if (message.pending) pending.value = message.pending;
    if (message.resources) resources.value = message.resources;
    applyModelState(message);
    // 服务器只在 agent_settled 发一次 busy=false —— 会话文件变了，刷新侧栏。
    if (message.busy === false) void refreshSessions();
  } else if (message.type === "ui_request") {
    const { request } = message;
    if (request.type !== "extension_ui_request") return;
    if (request.method === "select" || request.method === "confirm" || request.method === "input" || request.method === "editor") {
      if (extensionUi.dialog) extensionDialogQueue.push(request);
      else extensionUi.dialog = request;
    } else if (request.method === "notify") {
      extensionUi.notifications.push({
        id: request.id,
        message: request.message,
        type: request.notifyType ?? "info",
      });
      setTimeout(() => dismissNotification(request.id), 5_000);
    } else if (request.method === "setStatus") {
      if (request.statusText) extensionUi.statuses[request.statusKey] = request.statusText;
      else delete extensionUi.statuses[request.statusKey];
    } else if (request.method === "setWidget") {
      if (request.widgetLines) {
        extensionUi.widgets[request.widgetKey] = {
          lines: request.widgetLines,
          placement: request.widgetPlacement ?? "aboveEditor",
        };
      } else delete extensionUi.widgets[request.widgetKey];
    } else if (request.method === "setTitle") {
      document.title = request.title || "Pichamber";
    } else if (request.method === "set_editor_text") {
      draft.value = request.text;
    }
  } else if (message.type === "draft_restore") {
    draft.value = [...message.messages, draft.value?.trim()].filter(Boolean).join("\n\n");
  } else if (message.type === "error") {
    pushErrorToast(message.error);
  }
};

const onStatus = (status: WsStatus) => {
  if (status.type === "closed") {
    connected.value = false;
  } else if (status.type === "error") {
    pushErrorToast(status.error);
  }
};

const canSend = computed(
  () => connected.value && draft.value != undefined && draft.value.trim().length > 0,
);

const send = (streamingBehavior?: "steer" | "followUp") => {
  const text = draft.value?.trim();
  if (!canSend.value || !ws || !text) return;
  // Dismiss any lingering error toasts so they don't pile up across turns.
  extensionUi.notifications = extensionUi.notifications.filter((n) => n.type !== "error");
  ws.send({ type: "prompt", message: text, streamingBehavior });
  draft.value = undefined;
};

const abort = () => ws?.send({ type: "abort", restorePending: true });
const restorePending = () => ws?.send({ type: "restore_pending" });
const compact = () => ws?.send({ type: "compact" });

const respondToExtension = (
  response:
    | { type: "extension_ui_response"; id: string; cancelled: true }
    | { type: "extension_ui_response"; id: string; value: string }
    | { type: "extension_ui_response"; id: string; confirmed: boolean },
) => {
  ws?.send({ type: "ui_response", response });
  showNextExtensionDialog();
};

const dismissNotification = (id: string) => {
  const index = extensionUi.notifications.findIndex((notification) => notification.id === id);
  if (index !== -1) extensionUi.notifications.splice(index, 1);
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
  document.title = "Pichamber";
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
    respondToExtension,
    restorePending,
    send,
    setModel,
    setThinkingLevel,
    stats,
    thinking,
  };
};
