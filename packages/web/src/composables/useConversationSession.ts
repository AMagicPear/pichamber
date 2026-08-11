import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { computed, onBeforeUnmount, ref } from "vue";
import { toMessage } from "@/api/client";
import { connectSessionWs, type WsHandle, type WsStatus } from "@/api/ws";
import { refreshSessions } from "@/stores/workspace";
import type {
  LiveItem,
  ModelDescriptor,
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
/** Empty until the server confirms available models in `snapshot`/`state`. */
const availableModels = ref<ModelDescriptor[]>([]);
const model = ref<ModelDescriptor | undefined>();
const thinking = ref<ThinkingState>({ level: "off", availableLevels: ["off"] });
/** Pre-formatted Context-pane view; the server is the source of truth. */
const stats = ref<SessionStatsView | undefined>();
/** Most recent server-pushed error message (transport / invalid model /
 *  invalid thinking level / catastrophic prompt failure). Cleared when
 *  the user dismisses it, the next prompt sends, or the session drops. */
const lastError = ref<string | null>(null);

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
    lastSeq = message.seq;
    applyModelState(message);
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
    applyModelState(message);
    // 服务器只在 agent_settled 发一次 busy=false —— 会话文件变了，刷新侧栏。
    if (message.busy === false) void refreshSessions();
  } else if (message.type === "ui_request") {
    const { request } = message;
    if (request.type !== "extension_ui_request") return;
    if (
      request.method === "select" ||
      request.method === "confirm" ||
      request.method === "input" ||
      request.method === "editor"
    ) {
      // 对话框组件接入前自动取消，避免插件挂起（未来由前端弹窗应答）。
      const summary = request.method === "confirm" ? request.message : request.title;
      console.warn("[pichamber] 插件 UI 请求暂未支持，自动取消:", summary);
      ws?.send({ type: "ui_response", response: { type: "extension_ui_response", id: request.id, cancelled: true } });
    }
    // notify/setStatus/setWidget/setTitle/set_editor_text 为广播型，暂忽略。
  } else if (message.type === "error") {
    lastError.value = message.error;
  }
};

const onStatus = (status: WsStatus) => {
  if (status.type === "closed") {
    connected.value = false;
  } else if (status.type === "error") {
    lastError.value = status.error;
  }
};

const canSend = computed(
  () => connected.value && draft.value != undefined && draft.value.trim().length > 0,
);

const send = () => {
  const text = draft.value?.trim();
  if (!canSend.value || !ws || !text) return;
  // Clear any previous error so the toast doesn't linger into the next turn.
  lastError.value = null;
  ws.send({ type: "prompt", message: text });
  draft.value = undefined;
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

const dismissError = () => {
  lastError.value = null;
};

const disconnect = () => {
  ws?.close();
  ws = null;
  activeSessionId = null;
  connected.value = false;
  items.value = [];
  busy.value = false;
  model.value = undefined;
  availableModels.value = [];
  thinking.value = { level: "off", availableLevels: ["off"] };
  stats.value = undefined;
  lastError.value = null;
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
    lastError.value = toMessage(error);
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
    busy,
    canSend,
    connect,
    connected,
    disconnect,
    dismissError,
    draft,
    items,
    lastError,
    model,
    send,
    setModel,
    setThinkingLevel,
    stats,
    thinking,
  };
};
