/**
 * Session WebSocket handler.
 *
 * Owns one `SessionChannel` per active session. Every channel has a
 * single subscription against the runtime's event stream (works for
 * both SDK and RPC backends) plus the list of connected client sockets.
 *
 * The wire protocol is identical to the SDK-only implementation:
 * snapshot on connect, item/state broadcasts thereafter, and UI
 * requests proxied through the extension bridge.
 */
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
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
import type { ServerWebSocket } from "bun";
import { toMessage } from "../error";
import { createUiBridge, type UiBridge } from "../extensions/extension-ui";
import { displayWidgetLines } from "../extensions/widget-lines";
import { computeSessionStatsView } from "./context";
import { getEffectiveModelDescriptor, getThinkingState } from "./models";
import { conversationItems } from "./conversation";
import { deactivateSession, getSession } from "./session";
import type { SessionRuntime } from "./runtime";

// ─── WebSocket protocol multiplexing types ─────────────────────────────
//
// Bun's `websocket` callbacks receive (ws, message) — the data payload is
// always reachable via `ws.data`. At upgrade time the server attaches the
// matching handler to `ws.data.handler`, and the multiplex code just
// forwards. Adding a new protocol means writing one `WsHandler` and
// attaching it on upgrade.

/** Shape of a per-socket protocol handler. */
export type WsHandler = {
  open(ws: ServerWebSocket<WsData>): void | Promise<void>;
  message(ws: ServerWebSocket<WsData>, message: string | Buffer): void | Promise<void>;
  close(ws: ServerWebSocket<WsData>): void;
};

/** PTY data: protocol tag + handler + the ptyId open/close need. */
export type PtyWsData = {
  protocol: "pty";
  handler: WsHandler;
  ptyId: string;
  unsub?: () => void;
};

/** AI session data: protocol tag + handler + the sessionId. */
export type SessionWsData = {
  protocol: "session";
  handler: WsHandler;
  sessionId: string;
  closed?: boolean;
  attached?: boolean;
};

export type WsData = PtyWsData | SessionWsData;

type BunWS = ServerWebSocket<SessionWsData>;

type AssistantItem = Extract<LiveItem, { kind: "assistant" }>;

/** Durable extension UI state. Unlike notifications and dialogs, these UI
 * setters describe current state and must survive an RPC process emitting
 * them before a browser socket has attached. */
type ExtensionUiState = {
  statuses: Record<string, string>;
  widgets: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor" }>;
  title?: string;
};

/**
 * 统一 item 流状态：所有会话内容（回复/工具执行）按实际发生顺序排在同一个
 * 列表里，id 铸造后终生不变；权威状态（runtime）只在 agent_settled
 * 时对齐一次（compaction/分支导航/重试后重建）。
 */
type ChannelState = {
  items: LiveItem[];
  /** 正在流式的 assistant item（message_start 到 message_end）。 */
  streaming?: AssistantItem;
  busy: boolean;
  activity: AgentActivity;
  pending: PendingMessages;
  /** 广播序号：每个 ServerMessage 递增，客户端用它做间隙检测。 */
  seq: number;
  userCount: number;
  assistantCount: number;
  customCount: number;
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  thinking: ThinkingState;
  /** Pre-computed view for the Context pane; refreshed on every state
   *  change that could affect it (message_end, model switch, etc.). */
  stats: SessionStatsView;
  resources: RuntimeResources;
};

type SessionChannel = {
  sockets: Set<BunWS>;
  unsubscribe: () => void;
  state: ChannelState;
  /** 扩展 UI 桥：插件 ui.* 调用经 WS 转发，等前端应答。 */
  uiBridge: UiBridge;
  /** Current durable extension UI state, replayed to each newly connected client. */
  extensionUi: ExtensionUiState;
  /** Re-snapshot model + thinking state and broadcast to all sockets. */
  queueModelStateBroadcast: () => void;
  ready: Promise<void>;
  /** Messages submitted while compaction is running; flushed on compaction_end. */
  compactionQueue: CompactionQueuedMessage[];
  /** Runtime backing this channel — captured for the reconcile/stats helpers. */
  runtime: SessionRuntime;
};

/** A message held while compaction is running, mirroring the TUI's
 *  `compactionQueuedMessages` (queueCompactionMessage). Flushed as the first
 *  prompt + steer/followUp after compaction ends. */
type CompactionQueuedMessage = {
  text: string;
  mode: "steer" | "followUp";
};

const channelsBySession = new Map<string, SessionChannel>();

/** Broadcast a `state` frame to a channel's sockets, bumping `seq` first.
 *  The client detects gaps in `seq` and requests a resync, so every message
 *  through this function is monotonic. */
type StateFields = {
  busy?: boolean;
  activity?: AgentActivity;
  pending?: PendingMessages;
  model?: ModelDescriptor;
  availableModels?: ModelDescriptor[];
  thinking?: ThinkingState;
  stats?: SessionStatsView;
  resources?: RuntimeResources;
};
const broadcastState = (channel: SessionChannel, fields: StateFields) => {
  channel.state.seq += 1;
  const payload = JSON.stringify({ type: "state", seq: channel.state.seq, ...fields } satisfies ServerMessage);
  for (const socket of channel.sockets) {
    if (socket.readyState === 1) socket.send(payload);
  }
};

/** The pending view the client shows: SDK queue plus messages held in the
 *  compaction queue (which are not yet in the SDK's queue). */
const pendingWithQueue = (channel: SessionChannel): PendingMessages => ({
  steering: [
    ...channel.state.pending.steering,
    ...channel.compactionQueue.filter((m) => m.mode === "steer").map((m) => m.text),
  ],
  followUp: [
    ...channel.state.pending.followUp,
    ...channel.compactionQueue.filter((m) => m.mode === "followUp").map((m) => m.text),
  ],
});

const initialModelState = (): Pick<
  ChannelState,
  "model" | "availableModels" | "thinking" | "stats" | "resources"
> => ({
  model: undefined,
  availableModels: [],
  thinking: { level: "off", availableLevels: ["off"] },
  stats: {
    model: undefined,
    modified: "",
    context: { tokens: null, contextWindow: 0, percent: null, tokensText: "—" },
    messages: {
      total: 0,
      user: 0,
      assistant: 0,
      totalText: "0",
      userText: "0",
      assistantText: "0",
    },
    cost: { value: "$0.00", raw: 0 },
    lastAssistant: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    lastAssistantText: { input: "0", output: "0", reasoning: "0", cacheRead: "0", cacheWrite: "0" },
    cacheHit: "0.0%",
  },
  resources: {
    commands: [],
    tools: [],
    extensions: [],
    diagnostics: [],
    extensionInventoryAvailable: false,
  },
});

/** Cheap shallow diff on the fields the client actually renders. Skips the
 *  broadcast when nothing visible changed, so idle ticks don't wake the UI. */
const statsChanged = (prev: SessionStatsView, next: SessionStatsView): boolean => {
  if (prev.modified !== next.modified) return true;
  if (prev.context.tokens !== next.context.tokens) return true;
  if (prev.context.percent !== next.context.percent) return true;
  if (prev.context.tokensText !== next.context.tokensText) return true;
  if (prev.context.contextWindow !== next.context.contextWindow) return true;
  if (prev.messages.total !== next.messages.total) return true;
  if (prev.messages.user !== next.messages.user) return true;
  if (prev.messages.assistant !== next.messages.assistant) return true;
  if (prev.cost.raw !== next.cost.raw) return true;
  if (prev.cacheHit !== next.cacheHit) return true;
  if (prev.lastAssistant.input !== next.lastAssistant.input) return true;
  if (prev.lastAssistant.output !== next.lastAssistant.output) return true;
  if (prev.lastAssistant.reasoning !== next.lastAssistant.reasoning) return true;
  if (prev.lastAssistant.cacheRead !== next.lastAssistant.cacheRead) return true;
  if (prev.lastAssistant.cacheWrite !== next.lastAssistant.cacheWrite) return true;
  return false;
};

/** Pull the conversation entries through the runtime. RPC mode hits the
 *  subprocess once; SDK mode reuses the in-memory session manager. */
const fetchEntries = (runtime: SessionRuntime) => runtime.buildConversationEntries();

/** `reconcile` rebuilds the item list against the authoritative runtime
 *  state. New items keep their client-side ids; unmatched ones mint
 *  `e:<entryId>` so reconnects stay stable. */
const reconcile = async (
  channel: SessionChannel,
  keepLive: boolean,
): Promise<boolean> => {
  const state = channel.state;
  const entries = await fetchEntries(channel.runtime);
  const rebuilt = conversationItems(entries, state.items.filter((item) => item.phase === "committed"));
  const live = keepLive ? state.items.filter((item) => item.phase === "live") : [];
  const next = [...rebuilt, ...live];
  const changed =
    next.length !== state.items.length ||
    next.some((item, i) => {
      const prevItem = state.items[i];
      if (!prevItem) return true;
      return (
        prevItem.id !== item.id ||
        prevItem.phase !== item.phase ||
        (prevItem.kind !== "compaction" &&
          item.kind !== "compaction" &&
          prevItem.message !== item.message)
      );
    });
  state.items = next;
  return changed;
};

/** Build the runtime-relative snapshot of resources. Both backends
 *  expose the same `getResources()` interface, so we don't branch here. */
const snapshotResources = async (runtime: SessionRuntime): Promise<RuntimeResources> =>
  runtime.getResources();

const snapshotMessage = (channel: SessionChannel): ServerMessage => {
  const { seq, busy, activity, pending, items, model, availableModels, thinking, stats, resources } =
    channel.state;
  return {
    type: "snapshot",
    seq,
    busy,
    activity,
    pending,
    canRestorePending: channel.runtime.supportsQueueRestore,
    items,
    model,
    availableModels,
    thinking,
    stats,
    resources,
  };
};

/** Store the extension operations whose meaning is "set current value".
 * Notifications and dialogs are intentionally not retained: replaying either
 * one on reconnect would produce duplicate toasts or prompts. */
const applyExtensionUiRequest = (state: ExtensionUiState, request: RpcExtensionUIRequest) => {
  if (request.method === "setStatus") {
    if (request.statusText) state.statuses[request.statusKey] = request.statusText;
    else delete state.statuses[request.statusKey];
  } else if (request.method === "setWidget") {
    if (request.widgetLines) {
      state.widgets[request.widgetKey] = {
        lines: request.widgetLines,
        placement: request.widgetPlacement ?? "aboveEditor",
      };
    } else delete state.widgets[request.widgetKey];
  } else if (request.method === "setTitle") {
    state.title = request.title;
  }
};

/** Send the durable extension UI snapshot to one socket. This is separate
 * from the session snapshot because extension UI is event-shaped in the
 * public protocol, while the client already applies these setters idempotently. */
const replayExtensionUiState = (channel: SessionChannel, socket: BunWS) => {
  const send = (request: RpcExtensionUIRequest) => {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "ui_request", request } satisfies ServerMessage));
    }
  };
  for (const [statusKey, statusText] of Object.entries(channel.extensionUi.statuses)) {
    send({
      type: "extension_ui_request",
      id: crypto.randomUUID(),
      method: "setStatus",
      statusKey,
      statusText,
    });
  }
  for (const [widgetKey, widget] of Object.entries(channel.extensionUi.widgets)) {
    send({
      type: "extension_ui_request",
      id: crypto.randomUUID(),
      method: "setWidget",
      widgetKey,
      widgetLines: widget.lines,
      widgetPlacement: widget.placement,
    });
  }
  if (channel.extensionUi.title !== undefined) {
    send({
      type: "extension_ui_request",
      id: crypto.randomUUID(),
      method: "setTitle",
      title: channel.extensionUi.title,
    });
  }
};

/** External Pi's RPC mode uses its terminal theme when extensions build UI
 * labels, so `ctx.ui.*` strings can carry ANSI color codes. Web clients need
 * the semantic text only; normalize every textual UI field at this boundary
 * so SDK and RPC runtimes render identically. */
const stripExtensionUiAnsi = (request: RpcExtensionUIRequest): RpcExtensionUIRequest => {
  const strip = (text: string) => Bun.stripANSI(text);
  switch (request.method) {
    case "select":
      return { ...request, title: strip(request.title), options: request.options.map(strip) };
    case "confirm":
      return { ...request, title: strip(request.title), message: strip(request.message) };
    case "input":
      return {
        ...request,
        title: strip(request.title),
        placeholder: request.placeholder === undefined ? undefined : strip(request.placeholder),
      };
    case "editor":
      return {
        ...request,
        title: strip(request.title),
        prefill: request.prefill === undefined ? undefined : strip(request.prefill),
      };
    case "notify":
      return { ...request, message: strip(request.message) };
    case "setStatus":
      return {
        ...request,
        statusText: request.statusText === undefined ? undefined : strip(request.statusText),
      };
    case "setWidget":
      const widgetLines = request.widgetLines
        ? displayWidgetLines(request.widgetLines.map(strip))
        : undefined;
      return {
        ...request,
        widgetLines: widgetLines?.length ? widgetLines : undefined,
      };
    case "setTitle":
      return { ...request, title: strip(request.title) };
    case "set_editor_text":
      return { ...request, text: strip(request.text) };
  }
};

const attachListener = (sessionId: string, runtime: SessionRuntime): SessionChannel => {
  const existing = channelsBySession.get(sessionId);
  if (existing) return existing;

  let modelStateBroadcastQueued = false;
  const queueModelStateBroadcast = () => {
    if (modelStateBroadcastQueued) return;
    modelStateBroadcastQueued = true;
    queueMicrotask(() => {
      modelStateBroadcastQueued = false;
      void (async () => {
        const channel = channelsBySession.get(sessionId);
        if (!channel) return;
        try {
          const { model, availableModels } = await getEffectiveModelDescriptor(runtime);
          channel.state.model = model;
          channel.state.availableModels = availableModels;
          channel.state.thinking = getThinkingState(runtime);
          channel.state.stats = await computeSessionStatsView(runtime);
          broadcastState(channel, {
            model,
            availableModels,
            thinking: channel.state.thinking,
            stats: channel.state.stats,
          });
        } catch (error) {
          console.error("Failed to snapshot model state", sessionId, error);
        }
      })();
    });
  };

  const channel: SessionChannel = {
    sockets: new Set(),
    unsubscribe: () => undefined,
    state: {
      items: [],
      busy: false,
      activity: { phase: "idle" },
      pending: { steering: [], followUp: [] },
      seq: 0,
      userCount: 0,
      assistantCount: 0,
      customCount: 0,
      ...initialModelState(),
    },
    queueModelStateBroadcast,
    ready: Promise.resolve(),
    compactionQueue: [],
    extensionUi: { statuses: {}, widgets: {} },
    uiBridge: createUiBridge((request) => broadcastUiRequest(request)),
    runtime,
  };
  const broadcast = (msg: ServerMessage) => {
    const payload = JSON.stringify(msg);
    for (const bunWS of channel.sockets) {
      if (bunWS.readyState === 1) bunWS.send(payload);
    }
  };
  const broadcastItem = (item: LiveItem) => {
    channel.state.seq += 1;
    broadcast({ type: "item", seq: channel.state.seq, item });
  };
  const broadcastSnapshot = () => {
    channel.state.seq += 1;
    broadcast(snapshotMessage(channel));
  };
  const broadcastUiRequest = (request: RpcExtensionUIRequest) => {
    const normalized = stripExtensionUiAnsi(request);
    applyExtensionUiRequest(channel.extensionUi, normalized);
    broadcast({ type: "ui_request", request: normalized });
  };

  /** Common settlement shape shared by `compaction_end` and `agent_settled`:
   *  reset busy/activity/streaming, rebuild items against the authoritative
   *  runtime, refresh stats + resources, and broadcast the new state.
   *  Compaction additionally surfaces SDK errors as toasts and flushes its
   *  message queue before settling. */
  const settleChannel = async (options?: { errorMessage?: string; flushQueue?: boolean }) => {
    const state = channel.state;
    state.busy = false;
    state.activity = { phase: "idle" };
    state.streaming = undefined;

    if (options?.errorMessage) {
      broadcast({
        type: "ui_request",
        request: {
          type: "extension_ui_request",
          id: crypto.randomUUID(),
          method: "notify",
          message: options.errorMessage.replace(/^Compaction failed: /, ""),
          notifyType: "error",
        },
      } satisfies ServerMessage);
    }

    if (options?.flushQueue && channel.compactionQueue.length > 0) {
      const [first, ...rest] = channel.compactionQueue;
      channel.compactionQueue = [];
      runtime
        .prompt(first.text)
        .catch((err: unknown) => console.error("flush queued prompt failed", sessionId, err));
      for (const m of rest) {
        const submit = m.mode === "followUp" ? runtime.followUp(m.text) : runtime.steer(m.text);
        submit.catch((err: unknown) => console.error("flush queued message failed", sessionId, err));
      }
    }

    if (await reconcile(channel, false)) broadcastSnapshot();
    const settledStats = await computeSessionStatsView(runtime);
    state.resources = await snapshotResources(runtime);
    const fields: {
      busy: boolean;
      activity: AgentActivity;
      pending: PendingMessages;
      stats?: SessionStatsView;
      resources: RuntimeResources;
    } = {
      busy: state.busy,
      activity: state.activity,
      pending: pendingWithQueue(channel),
      resources: state.resources,
    };
    if (statsChanged(state.stats, settledStats)) {
      state.stats = settledStats;
      fields.stats = settledStats;
    }
    broadcastState(channel, fields);
  };

  /** Coalesce message-end stats refreshes. RPC stats need two subprocess
   * roundtrips, so concurrent refreshes can otherwise return out of order and
   * overwrite newer state. */
  let statsRefreshRunning = false;
  let statsRefreshPending = false;
  const queueStatsRefresh = () => {
    statsRefreshPending = true;
    if (statsRefreshRunning) return;
    statsRefreshRunning = true;
    void (async () => {
      while (statsRefreshPending) {
        statsRefreshPending = false;
        try {
          const stats = await computeSessionStatsView(runtime);
          if (statsChanged(channel.state.stats, stats)) {
            channel.state.stats = stats;
            broadcastState(channel, { stats });
          }
        } catch (error) {
          console.error("Failed to refresh session stats", sessionId, error);
        }
      }
      statsRefreshRunning = false;
      if (statsRefreshPending) queueStatsRefresh();
    })();
  };

  channel.unsubscribe = runtime.subscribe((event) => {
    const state = channel.state;
    switch (event.type) {
      case "agent_start": {
        state.busy = true;
        state.activity = { phase: "thinking" };
        broadcastState(channel, { busy: true, activity: state.activity });
        break;
      }
      case "message_start": {
        const { role } = event.message;
        if ((role === "user" || role === "assistant") && !state.busy) {
          state.busy = true;
          broadcastState(channel, { busy: true });
        }
        if (role === "user") {
          const item: LiveItem = {
            id: `u-${++state.userCount}`,
            kind: "user",
            phase: "live",
            message: event.message,
          };
          state.items.push(item);
          broadcastItem(item);
        } else if (role === "assistant") {
          state.activity = { phase: "responding" };
          broadcastState(channel, { activity: state.activity });
          const item: AssistantItem = {
            id: `a-${++state.assistantCount}`,
            kind: "assistant",
            phase: "live",
            message: event.message,
          };
          state.items.push(item);
          state.streaming = item;
          broadcastItem(item);
        } else if (role === "custom") {
          const item: LiveItem = {
            id: `c-${++state.customCount}`,
            kind: "custom",
            phase: "live",
            message: event.message,
          };
          state.items.push(item);
          broadcastItem(item);
        }
        break;
      }
      case "message_update": {
        if (state.streaming) {
          state.streaming.message = event.message;
          broadcastItem(state.streaming);
        }
        break;
      }
      case "message_end": {
        const message = event.message;
        const { role } = message;
        if (role === "user") {
          for (let i = state.items.length - 1; i >= 0; i--) {
            const item = state.items[i];
            if (item.kind === "user" && item.phase === "live") {
              item.message = message;
              item.phase = "committed";
              broadcastItem(item);
              break;
            }
          }
        } else if (role === "assistant") {
          const item = state.items.find(
            (i): i is Extract<LiveItem, { kind: "assistant" }> =>
              i.kind === "assistant" && i.phase === "live",
          );
          if (item) {
            item.message = message;
            item.phase = "committed";
            broadcastItem(item);
            if (state.streaming === item) state.streaming = undefined;
          }
        } else if (role === "toolResult") {
          const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
          if (typeof toolCallId === "string") {
            const item = state.items.find((i) => i.id === `tool:${toolCallId}`);
            if (item?.kind === "tool") {
              item.message = message;
              item.phase = "committed";
              broadcastItem(item);
            }
          }
        } else if (role === "custom") {
          const item = state.items.find((i) => i.kind === "custom" && i.phase === "live");
          if (item?.kind === "custom") {
            item.message = message;
            item.phase = "committed";
            // RPC doesn't emit entry_appended for custom messages; SDK
            // does and the entry id is stashed in entry_appended below.
            // We can't fetch the entry id synchronously here without
            // another roundtrip, so leave entryId empty for RPC and
            // accept that custom-message id stability across reconnects
            // may rely on order rather than entryId.
            broadcastItem(item);
          }
        }
        queueStatsRefresh();
        break;
      }
      case "tool_execution_start": {
        state.activity = { phase: "tool", toolName: event.toolName };
        broadcastState(channel, { activity: state.activity });
        const item: LiveItem = {
          id: `tool:${event.toolCallId}`,
          kind: "tool",
          phase: "live",
          tool: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            running: true,
            startedAt: Date.now(),
          },
        };
        state.items.push(item);
        broadcastItem(item);
        break;
      }
      case "tool_execution_update": {
        const item = state.items.find((i) => i.id === `tool:${event.toolCallId}`);
        if (item?.kind === "tool") {
          item.tool.result = event.partialResult;
          broadcastItem(item);
        }
        break;
      }
      case "tool_execution_end": {
        const item = state.items.find((i) => i.id === `tool:${event.toolCallId}`);
        if (item?.kind === "tool") {
          item.tool.result = event.result;
          item.tool.isError = event.isError;
          item.tool.running = false;
          broadcastItem(item);
        }
        const runningTool = state.items.find(
          (candidate): candidate is Extract<LiveItem, { kind: "tool" }> =>
            candidate.kind === "tool" && candidate.tool.running,
        );
        state.activity = runningTool
          ? { phase: "tool", toolName: runningTool.tool.toolName }
          : { phase: "thinking" };
        broadcastState(channel, { activity: state.activity });
        break;
      }
      case "queue_update": {
        state.pending = { steering: [...event.steering], followUp: [...event.followUp] };
        broadcastState(channel, { pending: state.pending });
        break;
      }
      case "compaction_start": {
        state.busy = true;
        state.activity = { phase: "compacting" };
        state.streaming = undefined;
        channel.compactionQueue = [];
        broadcastState(channel, { busy: true, activity: state.activity });
        break;
      }
      case "compaction_end": {
        const errorMessage = (event as { errorMessage?: unknown }).errorMessage;
        void settleChannel({
          errorMessage: typeof errorMessage === "string" && errorMessage ? errorMessage : undefined,
          flushQueue: true,
        });
        break;
      }
      case "auto_retry_start": {
        state.busy = true;
        state.activity = {
          phase: "retrying",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
        };
        broadcastState(channel, { busy: true, activity: state.activity });
        break;
      }
      case "agent_settled": {
        void settleChannel();
        break;
      }
      case "entry_appended": {
        const isModelEntry =
          event.entry.type === "model_change" || event.entry.type === "thinking_level_change";
        if (!isModelEntry && event.entry.type === "compaction") {
          void reconcile(channel, false).then((changed) => {
            if (changed) broadcastSnapshot();
          });
        }
        if (isModelEntry) queueModelStateBroadcast();
        break;
      }
      case "thinking_level_changed": {
        queueModelStateBroadcast();
        break;
      }
    }
  });
  channelsBySession.set(sessionId, channel);

  // Cross-process extension UI bridge. The SDK backend wires this up
  // itself inside `bindExtensions`; the RPC backend runs extensions
  // inside the subprocess and surfaces `ctx.ui.*` calls as
  // `extension_ui_request` frames on its stdout. Forward them to the
  // browser through the channel's existing `ui_request` broadcast so
  // dialogs, status bars, notifications, and widget updates reach
  // the UI just like they do against an in-process AgentSession.
  if (runtime.subscribeExtensionUiRequests) {
    const unsubUi = runtime.subscribeExtensionUiRequests((request) => {
      broadcastUiRequest(request);
    });
    const previousUnsub = channel.unsubscribe;
    channel.unsubscribe = () => {
      previousUnsub();
      unsubUi();
    };
  }
  // Reconcile before the first socket snapshot. This awaits RPC's
  // get_entries roundtrip instead of racing it against `open()`.
  channel.ready = (async () => {
    try {
      await reconcile(channel, true);
    } catch (error) {
      console.error("Failed to reconcile session", sessionId, error);
    }
    try {
      await runtime.bindExtensions(channel.uiBridge.context);
    } catch (error) {
      console.error("Failed to bind extensions", sessionId, error);
    }
    try {
      channel.state.resources = await snapshotResources(runtime);
    } catch (error) {
      console.error("Failed to snapshot resources", sessionId, error);
    }
  })();
  return channel;
};

const detachListener = (sessionId: string, ws: BunWS) => {
  const channel = channelsBySession.get(sessionId);
  if (!channel) return;
  channel.sockets.delete(ws);
  if (channel.sockets.size !== 0) return;
  void channel.ready.then(() => {
    if (channelsBySession.get(sessionId) !== channel || channel.sockets.size !== 0) return;
    channel.uiBridge.cancelPending();
    channel.unsubscribe();
    channelsBySession.delete(sessionId);
    deactivateSession(sessionId).catch((error) => {
      console.error("Failed to deactivate session", sessionId, error);
    });
  });
};

export const closeSessionSockets = (sessionId: string) => {
  const channel = channelsBySession.get(sessionId);
  if (!channel) return Promise.resolve();
  channel.uiBridge.cancelPending();
  channel.unsubscribe();
  channelsBySession.delete(sessionId);
  for (const ws of channel.sockets) {
    ws.data.closed = true;
    ws.data.attached = false;
    if (ws.readyState === 1) ws.close(1000, "Session deleted");
  }
  channel.sockets.clear();
  return channel.ready;
};

/** Recompute model inventory after a server-side credential mutation. */
export const refreshSessionModelState = (sessionId: string) => {
  channelsBySession.get(sessionId)?.queueModelStateBroadcast();
};

const sendError = (ws: BunWS, error: string) => {
  const msg: ServerMessage = { type: "error", error };
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

export const sessionWsHandler: WsHandler = {
  async open(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    bunWS.data.closed = false;
    const runtime = await getSession(sessionId);
    if (bunWS.data.closed) {
      if (!channelsBySession.has(sessionId)) {
        deactivateSession(sessionId).catch((error) => {
          console.error("Failed to deactivate session", sessionId, error);
        });
      }
      return;
    }
    if (!runtime) {
      sendError(bunWS, "session not found");
      bunWS.close();
      return;
    }
    const channel = attachListener(sessionId, runtime);
    channel.sockets.add(bunWS);
    bunWS.data.attached = true;
    await channel.ready;
    if (bunWS.data.closed || !bunWS.data.attached) return;
    try {
      const { model, availableModels } = await getEffectiveModelDescriptor(runtime);
      channel.state.model = model;
      channel.state.availableModels = availableModels;
      channel.state.thinking = getThinkingState(runtime);
      channel.state.stats = await computeSessionStatsView(runtime);
    } catch (error) {
      console.error("Failed to load model snapshot", sessionId, error);
    }
    replayExtensionUiState(channel, bunWS);
    bunWS.send(JSON.stringify(snapshotMessage(channel)));
  },
  async message(ws, message) {
    const bunWS = ws as BunWS;
    if (bunWS.data.closed || !bunWS.data.attached) return;

    let msg: unknown;
    try {
      msg = JSON.parse(typeof message === "string" ? message : message.toString());
    } catch {
      sendError(bunWS, "invalid JSON message");
      return;
    }
    if (!msg || typeof msg !== "object") {
      sendError(bunWS, "message must be an object");
      return;
    }
    const input = msg as { type?: unknown; [k: string]: unknown };
    const { sessionId } = bunWS.data;
    const runtime = await getSession(sessionId);
    if (bunWS.data.closed) return;
    if (!runtime) {
      sendError(bunWS, "session not found");
      return;
    }
    switch (input.type) {
      case "prompt": {
        if (typeof input.message !== "string") {
          sendError(bunWS, "prompt message must be a string");
          return;
        }
        if (bunWS.data.closed) return;
        const streamingBehavior =
          input.streamingBehavior === "steer" || input.streamingBehavior === "followUp"
            ? input.streamingBehavior
            : runtime.isStreaming
              ? "steer"
              : undefined;
        const channel = channelsBySession.get(sessionId);
        if (runtime.isCompacting && channel) {
          if (!input.message.startsWith("/")) {
            channel.compactionQueue.push({
              text: input.message,
              mode: streamingBehavior === "followUp" ? "followUp" : "steer",
            });
            broadcastState(channel, { pending: pendingWithQueue(channel) });
          } else {
            runtime
              .prompt(input.message)
              .catch((err: unknown) => sendError(bunWS, toMessage(err)));
          }
          return;
        }
        runtime
          .prompt(input.message, streamingBehavior ? { streamingBehavior } : {})
          .finally(() => {
            const channel = channelsBySession.get(sessionId);
            if (!channel) return;
            void snapshotResources(runtime).then((resources) => {
              channel.state.resources = resources;
              broadcastState(channel, { resources });
            });
          })
          .catch((err: unknown) => sendError(bunWS, toMessage(err)));
        return;
      }
      case "restore_pending": {
        if (!runtime.supportsQueueRestore) {
          sendError(bunWS, "Restoring pending messages is not supported by the external Pi runtime");
          return;
        }
        const restored = runtime.clearQueue();
        const messages = [...restored.steering, ...restored.followUp];
        if (messages.length > 0 && bunWS.readyState === 1) {
          bunWS.send(JSON.stringify({ type: "draft_restore", messages } satisfies ServerMessage));
        }
        return;
      }
      case "abort": {
        if (input.restorePending !== false) {
          const restored = runtime.clearQueue();
          const messages = [...restored.steering, ...restored.followUp];
          if (messages.length > 0 && bunWS.readyState === 1) {
            bunWS.send(JSON.stringify({ type: "draft_restore", messages } satisfies ServerMessage));
          }
        }
        runtime.abort().catch((error) => sendError(bunWS, toMessage(error)));
        return;
      }
      case "compact": {
        const customInstructions =
          typeof input.customInstructions === "string" && input.customInstructions.trim()
            ? input.customInstructions.trim()
            : undefined;
        runtime
          .compact(customInstructions)
          .catch((err: unknown) => console.error("compact failed", sessionId, toMessage(err)));
        return;
      }
      case "set_model": {
        if (typeof input.provider !== "string" || typeof input.modelId !== "string") {
          sendError(bunWS, "set_model requires provider+modelId strings");
          return;
        }
        try {
          await runtime.setModel(input.provider, input.modelId);
          channelsBySession.get(sessionId)?.queueModelStateBroadcast();
        } catch (err) {
          sendError(bunWS, toMessage(err));
        }
        return;
      }
      case "set_thinking_level": {
        if (typeof input.level !== "string") {
          sendError(bunWS, "set_thinking_level requires a level string");
          return;
        }
        try {
          await runtime.setThinkingLevel(input.level as Parameters<typeof runtime.setThinkingLevel>[0]);
          channelsBySession.get(sessionId)?.queueModelStateBroadcast();
        } catch (err) {
          sendError(bunWS, toMessage(err));
        }
        return;
      }
      case "resync": {
        const channel = channelsBySession.get(sessionId);
        if (channel && bunWS.readyState === 1) bunWS.send(JSON.stringify(snapshotMessage(channel)));
        return;
      }
      case "ui_response": {
        const response = input.response as unknown;
        if (
          !response ||
          typeof response !== "object" ||
          typeof (response as { id?: unknown }).id !== "string"
        ) {
          sendError(bunWS, "ui_response requires an id");
          return;
        }
        const cast = response as RpcExtensionUIResponse;
        // SDK: resolves the pending dialog in the in-process bridge.
        // RPC: writes the response back to the subprocess's stdin so
        // its own UI context resolves the matching dialog.
        const channel = channelsBySession.get(sessionId);
        if (channel) {
          channel.uiBridge.handleResponse(cast);
          runtime.sendExtensionUiResponse?.(cast);
        }
        return;
      }
      default:
        return;
    }
  },
  close(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    bunWS.data.closed = true;
    if (!bunWS.data.attached) return;
    bunWS.data.attached = false;
    detachListener(sessionId, bunWS);
  },
};
