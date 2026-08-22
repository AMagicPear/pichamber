/**
 * Session WebSocket handler.
 *
 * One `SessionChannel` per active session, backed by Pi's official
 * `AgentSessionRuntime`. Every channel subscribes to the runtime's
 * official `AgentSessionEvent` stream and forwards events verbatim to
 * clients; the surrounding state (activity / pending / model / thinking /
 * stats / resources) is computed on the server and emitted through
 * partial `state` frames. `activity.phase === "idle"` is the sole
 * not-working signal — there is no separate `busy` flag (the agent loop
 * always emits `agent_start` before any user/assistant `message_start`,
 * so busy would just duplicate activity).
 *
 * SDK is the first-class path — `AgentSessionRuntime` is consumed
 * directly without a wrapper interface.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  buildContextEntries,
  sessionEntryToContextMessages,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type RpcExtensionUIRequest,
  type RpcExtensionUIResponse,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentActivity,
  ExtensionInfo,
  ImageContent,
  ModelDescriptor,
  PendingMessages,
  RuntimeResources,
  RuntimeToolInfo,
  ServerMessage,
  SessionStatsView,
  ThinkingState,
} from "@amagicpear/pichamber-shared";
import type { ServerWebSocket } from "bun";
import { toMessage } from "../error";
import { createUiBridge, type UiBridge } from "../extensions/extension-ui";
import { computeSessionStatsView } from "./context";
import { getEffectiveModelDescriptor, getThinkingState } from "./models";
import { deactivateSession, getSession } from "./session";

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

/** Durable extension UI state. Unlike notifications and dialogs, these UI
 *  setters describe current state and must survive late emitters before a
 *  browser socket has attached. */
type ExtensionUiState = {
  statuses: Record<string, string>;
  widgets: Record<string, { widgetLines: string[] | undefined; placement: "aboveEditor" | "belowEditor" }>;
  title?: string;
};

type ChannelState = {
  /** Latest official `AgentMessage[]` rebuilt from session entries. */
  messages: AgentMessage[];
  activity: AgentActivity;
  pending: PendingMessages;
  /** Monotonic broadcast sequence; clients detect gaps and resync. */
  seq: number;
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
  /** Extension UI bridge: extension `ctx.ui.*` calls round-trip through
   *  the WS layer via this. */
  uiBridge: UiBridge;
  /** Current durable extension UI state, replayed to each new client. */
  extensionUi: ExtensionUiState;
  /** Re-snapshot model + thinking state and broadcast to all sockets. */
  queueModelStateBroadcast: () => void;
  ready: Promise<void>;
  /** Messages submitted while compaction is running; flushed on compaction_end. */
  compactionQueue: CompactionQueuedMessage[];
  /** Runtime backing this channel — captured for the reconcile/stats helpers. */
  runtime: AgentSessionRuntime;
};

/** A message held while compaction is running, mirroring the TUI's
 *  `compactionQueuedMessages` (queueCompactionMessage). Flushed as the first
 *  prompt + steer/followUp after compaction ends. */
type CompactionQueuedMessage = {
  text: string;
  images?: ImageContent[];
  mode: "steer" | "followUp";
};

const SUPPORTED_IMAGE_MIME_TYPES = new Set<ImageContent["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_PROMPT_IMAGES = 8;
const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_IMAGES_BYTES = 25 * 1024 * 1024;

const base64ByteLength = (data: string) =>
  (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

const parsePromptImages = (value: unknown): ImageContent[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PROMPT_IMAGES) return null;
  let totalBytes = 0;
  const images: ImageContent[] = [];
  for (const image of value) {
    if (
      !image ||
      typeof image !== "object" ||
      (image as { type?: unknown }).type !== "image" ||
      typeof (image as { data?: unknown }).data !== "string" ||
      !SUPPORTED_IMAGE_MIME_TYPES.has((image as { mimeType?: ImageContent["mimeType"] }).mimeType as ImageContent["mimeType"])
    ) return null;
    const data = (image as { data: string }).data;
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
    const bytes = base64ByteLength(data);
    totalBytes += bytes;
    if (bytes > MAX_PROMPT_IMAGE_BYTES || totalBytes > MAX_PROMPT_IMAGES_BYTES) return null;
    images.push(image as ImageContent);
  }
  return images;
};

const channelsBySession = new Map<string, SessionChannel>();

/** Build the resource inventory for one session: runtime extension
 *  commands / tools / extensions, without any client-side builtin shelf
 *  (the GUI built-ins like `/compact` live in the web client and are
 *  merged into the command picker there — see
 *  `packages/web/src/composables/builtin-commands.ts`). */
const snapshotResources = (runtime: AgentSessionRuntime): RuntimeResources => {
  const session = runtime.session;
  const result = session.resourceLoader.getExtensions();
  const activeTools = new Set(result.runtime.getActiveTools());
  const includeSkills = session.settingsManager.getEnableSkillCommands();
  const extensionCommands = includeSkills
    ? result.runtime.getCommands()
    : result.runtime.getCommands().filter((command) => command.source !== "skill");
  return {
    commands: extensionCommands,
    tools: result.runtime.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      sourceInfo: tool.sourceInfo,
      active: activeTools.has(tool.name),
    } satisfies RuntimeToolInfo)),
    extensions: result.extensions
      .filter((extension) => !extension.hidden)
      .map((extension) => ({
        path: extension.path,
        sourceInfo: extension.sourceInfo,
        commands: [...extension.commands.keys()],
        tools: [...extension.tools.keys()],
      } satisfies ExtensionInfo)),
    diagnostics: result.errors,
    extensionInventoryAvailable: true,
  };
};

/** Broadcast a `state` frame to a channel's sockets, bumping `seq` first.
 *  The client detects gaps in `seq` and requests a resync, so every message
 *  through this function is monotonic. */
type StateFields = {
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

/** Ordered, compaction-aware official `AgentMessage[]` for one session,
 *  via pi's own conversion helpers (compaction summaries / custom messages
 *  / branch summaries all land as official `AgentMessage` roles). */
const conversationMessages = (entries: SessionEntry[]): AgentMessage[] =>
  buildContextEntries(entries).flatMap(sessionEntryToContextMessages);

/** `reconcile` rebuilds the official `AgentMessage[]` from the authoritative
 *  session entries (compaction-aware, via pi's own conversion helpers). */
const reconcile = async (channel: SessionChannel): Promise<boolean> => {
  const state = channel.state;
  const entries = channel.runtime.session.sessionManager.buildContextEntries();
  const next = conversationMessages(entries);
  const changed =
    next.length !== state.messages.length ||
    next.some((message, i) => message !== state.messages[i]);
  state.messages = next;
  return changed;
};

const snapshotMessage = (channel: SessionChannel): ServerMessage => {
  const { seq, activity, pending, messages, model, availableModels, thinking, stats, resources } =
    channel.state;
  return {
    type: "snapshot",
    seq,
    activity,
    pending,
    canRestorePending: true,
    messages,
    model,
    availableModels,
    thinking,
    stats,
    resources,
  };
};

/** Store the extension operations whose meaning is "set current value".
 *  Notifications and dialogs are intentionally not retained: replaying
 *  either one on reconnect would produce duplicate toasts or prompts. */
const applyExtensionUiRequest = (state: ExtensionUiState, request: RpcExtensionUIRequest) => {
  if (request.method === "setStatus") {
    if (request.statusText) state.statuses[request.statusKey] = request.statusText;
    else delete state.statuses[request.statusKey];
  } else if (request.method === "setWidget") {
    if (request.widgetLines) {
      state.widgets[request.widgetKey] = {
        widgetLines: request.widgetLines,
        placement: request.widgetPlacement ?? "aboveEditor",
      };
    } else delete state.widgets[request.widgetKey];
  } else if (request.method === "setTitle") {
    state.title = request.title;
  }
};

/** Send the durable extension UI snapshot to one socket. This is separate
 *  from the session snapshot because extension UI is event-shaped in the
 *  public protocol, while the client already applies these setters idempotently. */
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
      widgetLines: widget.widgetLines,
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

const attachListener = (sessionId: string, runtime: AgentSessionRuntime): SessionChannel => {
  const existing = channelsBySession.get(sessionId);
  if (existing) return existing;
  const session = runtime.session;

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
      messages: [],
      activity: { phase: "idle" },
      pending: { steering: [], followUp: [] },
      seq: 0,
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
  /** Forward one official `AgentSessionEvent` untouched. */
  const broadcastEvent = (event: AgentSessionEvent) => {
    channel.state.seq += 1;
    broadcast({ type: "event", seq: channel.state.seq, event } satisfies ServerMessage);
  };
  const broadcastSnapshot = () => {
    channel.state.seq += 1;
    broadcast(snapshotMessage(channel));
  };
  /** 扩展 UI 请求原样转发。服务端不解析扩展的私有 widget 协议（如
   *  pi-subagents 的 `PI_SUBAGENT_*` 前缀）——setWidget 的 widget 行由
   *  前端消费方解析成结构化 `ExtensionWidget`。 */
  const broadcastUiRequest = (request: RpcExtensionUIRequest) => {
    applyExtensionUiRequest(channel.extensionUi, request);
    broadcast({ type: "ui_request", request });
  };

  /** Common settlement shape shared by `compaction_end` and `agent_settled`:
   *  reset activity, rebuild messages against the authoritative runtime,
   *  refresh stats + resources, and broadcast the new state.
   *  Compaction additionally flushes its queued messages before settling.
   *  Compaction errors are NOT toasted here — the `compaction_end` event is
   *  forwarded verbatim and the client surfaces `errorMessage` itself. */
  const settleChannel = async (options?: { flushQueue?: boolean }) => {
    const state = channel.state;
    state.activity = { phase: "idle" };

    if (options?.flushQueue && channel.compactionQueue.length > 0) {
      const [first, ...rest] = channel.compactionQueue;
      channel.compactionQueue = [];
      session
        .prompt(first.text, first.images ? { images: first.images } : undefined)
        .catch((err: unknown) => console.error("flush queued prompt failed", sessionId, err));
      for (const m of rest) {
        const submit = m.mode === "followUp"
          ? session.prompt(m.text, { streamingBehavior: "followUp", images: m.images })
          : session.prompt(m.text, { streamingBehavior: "steer", images: m.images });
        submit.catch((err: unknown) => console.error("flush queued message failed", sessionId, err));
      }
    }

    if (await reconcile(channel)) broadcastSnapshot();
    const settledStats = await computeSessionStatsView(runtime);
    state.resources = snapshotResources(runtime);
    const fields: {
      activity: AgentActivity;
      pending: PendingMessages;
      stats?: SessionStatsView;
      resources: RuntimeResources;
    } = {
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

  /** Coalesce message-end stats refreshes so a flurry of message_end
   *  events during streaming only triggers one snapshot roundtrip. */
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

  channel.unsubscribe = session.subscribe((event) => {
    const state = channel.state;
    switch (event.type) {
      case "agent_start": {
        state.activity = { phase: "working" };
        broadcastState(channel, { activity: state.activity });
        break;
      }
      // Conversation content events (official `AgentSessionEvent`) are
      // forwarded verbatim; the client mirrors TUI's handleEvent and builds
      // the conversation view from them. activity/pending are carried by
      // `state` frames (server-computed display state); activity only
      // follows the TUI StatusIndicator: agent_start → working,
      // compaction_start → compacting, auto_retry_start → retrying,
      // settlement → idle, and `idle` doubles as the not-busy signal
      // (the agent loop always emits agent_start before any
      // user/assistant message_start, so no defensive busy flip is
      // needed here). message/tool events don't touch it (fine-grained
      // status is rendered by the message stream).
      case "message_start":
      case "message_update":
        broadcastEvent(event);
        break;
      case "message_end":
        queueStatsRefresh();
        broadcastEvent(event);
        break;
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        broadcastEvent(event);
        break;
      case "queue_update": {
        state.pending = { steering: [...event.steering], followUp: [...event.followUp] };
        broadcastState(channel, { pending: state.pending });
        break;
      }
      case "compaction_start": {
        state.activity = { phase: "compacting" };
        channel.compactionQueue = [];
        broadcastState(channel, { activity: state.activity });
        break;
      }
      case "compaction_end": {
        // Forward the official event verbatim: the client toasts
        // `errorMessage` itself (pushErrorToast) instead of the server
        // fabricating an extension `notify` frame.
        broadcastEvent(event);
        void settleChannel({ flushQueue: true });
        break;
      }
      case "auto_retry_start": {
        state.activity = {
          phase: "retrying",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
        };
        broadcastState(channel, { activity: state.activity });
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
          void reconcile(channel).then((changed) => {
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

  // Reconcile before the first socket snapshot so the initial message list
  // reflects any session entries (including the SessionHeader) the manager
  // already loaded.
  channel.ready = (async () => {
    try {
      await reconcile(channel);
    } catch (error) {
      console.error("Failed to reconcile session", sessionId, error);
    }
    try {
      await session.bindExtensions({ uiContext: channel.uiBridge.context, mode: "rpc" });
    } catch (error) {
      console.error("Failed to bind extensions", sessionId, error);
    }
    try {
      channel.state.resources = snapshotResources(runtime);
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
    const session = runtime.session;
    switch (input.type) {
      case "prompt": {
        if (typeof input.message !== "string") {
          sendError(bunWS, "prompt message must be a string");
          return;
        }
        const images = parsePromptImages(input.images);
        if (!images) {
          sendError(bunWS, "prompt images must be up to 8 PNG, JPEG, WebP, or GIF files (10 MB each, 25 MB total)");
          return;
        }
        if (!input.message.trim() && images.length === 0) {
          sendError(bunWS, "prompt requires a message or image");
          return;
        }
        if (bunWS.data.closed) return;
        // Streaming behaviour is decided server-side: the client's request is
        // only a preference. Whether we're actually streaming is determined
        // by `runtime.session.isStreaming` — don't trust the client's
        // local activity snapshot (broadcasts may lag). Non-streaming prompts
        // always start a new turn.
        const requested = input.streamingBehavior === "steer" || input.streamingBehavior === "followUp"
          ? input.streamingBehavior
          : undefined;
        const streamingBehavior = session.isStreaming ? requested ?? "steer" : undefined;
        const channel = channelsBySession.get(sessionId);
        if (session.isCompacting && channel) {
          if (!input.message.startsWith("/")) {
            channel.compactionQueue.push({
              text: input.message,
              images: images.length > 0 ? images : undefined,
              mode: streamingBehavior === "followUp" ? "followUp" : "steer",
            });
            broadcastState(channel, { pending: pendingWithQueue(channel) });
          } else {
            session
              .prompt(input.message, images.length > 0 ? { images } : undefined)
              .catch((err: unknown) => sendError(bunWS, toMessage(err)));
          }
          return;
        }
        session
          .prompt(input.message, {
            streamingBehavior,
            images: images.length > 0 ? images : undefined,
          })
          .finally(() => {
            const channel = channelsBySession.get(sessionId);
            if (!channel) return;
            channel.state.resources = snapshotResources(runtime);
            broadcastState(channel, { resources: channel.state.resources });
          })
          .catch((err: unknown) => sendError(bunWS, toMessage(err)));
        return;
      }
      case "restore_pending": {
        const restored = session.clearQueue();
        const messages = [...restored.steering, ...restored.followUp];
        if (messages.length > 0 && bunWS.readyState === 1) {
          bunWS.send(JSON.stringify({ type: "draft_restore", messages } satisfies ServerMessage));
        }
        return;
      }
      case "abort": {
        if (input.restorePending !== false) {
          const restored = session.clearQueue();
          const messages = [...restored.steering, ...restored.followUp];
          if (messages.length > 0 && bunWS.readyState === 1) {
            bunWS.send(JSON.stringify({ type: "draft_restore", messages } satisfies ServerMessage));
          }
        }
        session.abort().catch((error) => sendError(bunWS, toMessage(error)));
        return;
      }
      case "compact": {
        const customInstructions =
          typeof input.customInstructions === "string" && input.customInstructions.trim()
            ? input.customInstructions.trim()
            : undefined;
        session
          .compact(customInstructions)
          .catch((err: unknown) => console.error("compact failed", sessionId, toMessage(err)));
        return;
      }
      case "reload": {
        if (session.isStreaming) {
          sendError(bunWS, "Wait for the current response to finish before reloading.");
          return;
        }
        if (session.isCompacting) {
          sendError(bunWS, "Wait for compaction to finish before reloading.");
          return;
        }
        try {
          await session.reload();
        } catch (err) {
          sendError(bunWS, toMessage(err));
          return;
        }
        // Reload rebuilds the extension runner, so any UI bindings from
        // the old runner are stale. Re-bind before re-snapshotting so the
        // next prompt sees fresh state.
        const channel = channelsBySession.get(sessionId);
        if (channel) {
          try {
            await session.bindExtensions({ uiContext: channel.uiBridge.context, mode: "rpc" });
          } catch (err) {
            console.error("Failed to re-bind extensions after reload", sessionId, err);
          }
          try {
            channel.state.resources = snapshotResources(runtime);
          } catch (err) {
            console.error("Failed to snapshot resources after reload", sessionId, err);
          }
          broadcastState(channel, { resources: channel.state.resources });
        }
        return;
      }
      case "set_model": {
        if (typeof input.provider !== "string" || typeof input.modelId !== "string") {
          sendError(bunWS, "set_model requires provider+modelId strings");
          return;
        }
        try {
          const target = session.modelRuntime.getModel(input.provider, input.modelId);
          if (!target) throw new Error(`Unknown model: ${input.provider}/${input.modelId}`);
          await session.setModel(target);
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
          session.setThinkingLevel(input.level as Parameters<typeof session.setThinkingLevel>[0]);
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
        const channel = channelsBySession.get(sessionId);
        channel?.uiBridge.handleResponse(response as RpcExtensionUIResponse);
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