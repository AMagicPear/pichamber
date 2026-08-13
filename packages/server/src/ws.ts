import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
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
import { computeSessionStatsView } from "./context";
import { toMessage } from "./error";
import { createUiBridge, type UiBridge } from "./extension-ui";
import { expandFileRefs } from "./file-refs";
import { getEffectiveModelDescriptor, getThinkingState } from "./models";
import { conversationItems, deactivateSession, getConversationEntries, getSession } from "./session";
import type { SessionWsData, WsHandler } from "./index";

type BunWS = ServerWebSocket<SessionWsData>;

type AssistantItem = Extract<LiveItem, { kind: "assistant" }>;

/**
 * 统一 item 流状态：所有会话内容（回复/工具执行）按实际发生顺序排在同一个
 * 列表里，id 铸造后终生不变；权威状态（session manager）只在 agent_settled
 * 时对齐一次（compaction/分支导航/重试后重建，按对象身份保持 id）。
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
  /** Re-snapshot model + thinking state and broadcast to all sockets. */
  queueModelStateBroadcast: () => void;
  ready: Promise<void>;
};

// sessionId → one shared SDK listener plus all subscribed sockets.
const channelsBySession = new Map<string, SessionChannel>();

const broadcastChannelState = (
  channel: SessionChannel,
  fields: {
    busy?: boolean;
    activity?: AgentActivity;
    pending?: PendingMessages;
    model?: ModelDescriptor;
    availableModels?: ModelDescriptor[];
    thinking?: ThinkingState;
    stats?: SessionStatsView;
    resources?: RuntimeResources;
  },
) => {
  channel.state.seq += 1;
  const payload = JSON.stringify({ type: "state", seq: channel.state.seq, ...fields } satisfies ServerMessage);
  for (const socket of channel.sockets) {
    if (socket.readyState === 1) socket.send(payload);
  }
};

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
    messages: { total: 0, user: 0, assistant: 0 },
    cost: { value: "$0.00", raw: 0 },
    lastAssistant: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cacheHit: "0.0%",
  },
  resources: { commands: [], tools: [], extensions: [], diagnostics: [] },
});

const snapshotResources = (session: AgentSession): RuntimeResources => {
  const result = session.resourceLoader.getExtensions();
  const activeTools = new Set(result.runtime.getActiveTools());
  return {
    commands: result.runtime.getCommands(),
    tools: result.runtime.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      active: activeTools.has(tool.name),
      sourceInfo: tool.sourceInfo,
    })),
    extensions: result.extensions
      .filter((extension) => !extension.hidden)
      .map((extension) => ({
        path: extension.path,
        sourceInfo: extension.sourceInfo,
        commands: [...extension.commands.keys()],
        tools: [...extension.tools.keys()],
      })),
    diagnostics: result.errors,
  };
};

/** 把权威条目重建为 item 列表；无变化的场合（settle 时内容一致）跳过快照广播。 */
const reconcile = (channel: SessionChannel, session: AgentSession, keepLive: boolean) => {
  const state = channel.state;
  const rebuilt = conversationItems(
    session,
    state.items.filter((item) => item.phase === "committed"),
  );
  const live = keepLive ? state.items.filter((item) => item.phase === "live") : [];
  const next = [...rebuilt, ...live];
  const changed =
    next.length !== state.items.length ||
    next.some(
      (item, i) =>
        state.items[i]?.id !== item.id ||
        state.items[i]?.message !== item.message ||
        state.items[i]?.phase !== item.phase,
    );
  state.items = next;
  return changed;
};

const snapshotMessage = (channel: SessionChannel): ServerMessage => {
  const { seq, busy, activity, pending, items, model, availableModels, thinking, stats, resources } =
    channel.state;
  return {
    type: "snapshot",
    seq,
    busy,
    activity,
    pending,
    items,
    model,
    availableModels,
    thinking,
    stats,
    resources,
  };
};

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

/** 扫描最后一个 custom_message 条目（自定义消息在 emit 前已持久化）。 */
const lastCustomEntry = (session: AgentSession) => {
  const entries = getConversationEntries(session);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.type === "custom_message") return entries[i];
  }
  return undefined;
};

const attachListener = (sessionId: string, session: AgentSession): SessionChannel => {
  const existing = channelsBySession.get(sessionId);
  if (existing) return existing;

  let modelStateBroadcastQueued = false;
  const queueModelStateBroadcast = () => {
    if (modelStateBroadcastQueued) return;
    modelStateBroadcastQueued = true;
    queueMicrotask(() => {
      modelStateBroadcastQueued = false;
      getEffectiveModelDescriptor(session)
        .then(({ model, availableModels }) => {
          const channel = channelsBySession.get(sessionId);
          if (!channel) return;
          channel.state.model = model;
          channel.state.availableModels = availableModels;
          channel.state.thinking = getThinkingState(session);
          // Model/thinking switches also change `contextUsage.contextWindow`,
          // so the Context pane's percentage needs a fresh recompute in the
          // same broadcast.
          const stats = computeSessionStatsView(session);
          channel.state.stats = stats;
          broadcastState(channel, {
            model,
            availableModels,
            thinking: channel.state.thinking,
            stats,
          });
        })
        .catch((error) => {
          console.error("Failed to snapshot model state", sessionId, error);
        });
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
    uiBridge: createUiBridge((request) => broadcast({ type: "ui_request", request })),
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
  const broadcastState = (
    channel: SessionChannel,
    fields: {
      busy?: boolean;
      activity?: AgentActivity;
      pending?: PendingMessages;
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
      stats?: SessionStatsView;
      resources?: RuntimeResources;
    },
  ) => {
    channel.state.seq += 1;
    broadcast({ type: "state", seq: channel.state.seq, ...fields });
  };
  const broadcastSnapshot = () => {
    channel.state.seq += 1;
    broadcast(snapshotMessage(channel));
  };

  channel.unsubscribe = session.subscribe((event) => {
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
        // busy 只在真正的 agent 回合置位（回合必然以 user/assistant 消息开始）；
        // 纯扩展命令（custom 消息）不经过 agent 回合，也不会收到 agent_settled。
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
          // 插件自定义消息（扩展 sendMessage）也进会话流，前端可按需渲染。
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
          // user 消息 message_start/end 紧邻发射，扫描最后一个 live user item 即可
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
          // 用 FIFO 匹配而非 streaming 指针：abort 后迟到 message_end 可能
          // 落在新 run 已开始的时刻，streaming 已被新消息占用。
          const item = state.items.find((i) => i.kind === "assistant" && i.phase === "live");
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
          // 自定义消息在 emit 前已持久化（sendCustomMessage 先
          // appendCustomMessageEntry），同步扫描即可拿到条目 id。
          const entry = lastCustomEntry(session);
          const item = state.items.find((i) => i.kind === "custom" && i.phase === "live");
          if (item?.kind === "custom") {
            item.message = message;
            item.phase = "committed";
            if (entry) item.entryId = entry.id;
            broadcastItem(item);
          }
        }
        // Stats refresh: pi appends the entry to the session manager just
        // before emitting this event, so the new totals (including the
        // freshly-closed assistant turn's usage) are visible immediately.
        // `message_start` doesn't touch totals, so we don't need to
        // recompute there.
        const stats = computeSessionStatsView(session);
        if (statsChanged(state.stats, stats)) {
          state.stats = stats;
          broadcastState(channel, { stats });
        }
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
        broadcastState(channel, { busy: true, activity: state.activity });
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
        state.busy = false;
        state.activity = { phase: "idle" };
        state.streaming = undefined;
        // 与权威状态对齐：compaction/重试/分支导航会改变条目，内容一致时跳过
        // 快照广播（id 按对象身份保持，客户端无感）。
        if (reconcile(channel, session, false)) broadcastSnapshot();
        // Stats also need a refresh after settlement: compactions, retries
        // and branch navigation all change message counts and (after the
        // next LLM response) contextUsage. We only broadcast when the view
        // actually moved to avoid waking the client on idle ticks.
        const settledStats = computeSessionStatsView(session);
        state.resources = snapshotResources(session);
        const statsFields: {
          busy: false;
          activity: AgentActivity;
          stats?: SessionStatsView;
          resources: RuntimeResources;
        } = { busy: false, activity: state.activity, resources: state.resources };
        if (statsChanged(state.stats, settledStats)) {
          state.stats = settledStats;
          statsFields.stats = settledStats;
        }
        broadcastState(channel, statsFields);
        break;
      }
      case "entry_appended": {
        const isModelEntry =
          event.entry.type === "model_change" || event.entry.type === "thinking_level_change";
        // Pi emits several synchronous events for one model switch. Queue
        // one snapshot for the whole mutation instead of broadcasting the
        // same model inventory once per entry.
        if (isModelEntry) queueModelStateBroadcast();
        break;
      }
      case "thinking_level_changed": {
        // Keep the client in sync when Pi clamps a requested level without a
        // separate entry visible to the transcript.
        queueModelStateBroadcast();
        break;
      }
    }
  });
  // 订阅前先对齐一次，保证首个连接的 snapshot 就带完整历史。
  reconcile(channel, session, true);
  channelsBySession.set(sessionId, channel);
  // 与 TUI/RPC 相同：先安装 listener，再 await extension binding，这样
  // session_start 产生的自定义消息/UI 请求不会丢失，首个 snapshot 也能带命令。
  channel.ready = Promise.resolve()
    .then(() => session.bindExtensions({ uiContext: channel.uiBridge.context, mode: "rpc" }))
    .then(() => {
      channel.state.resources = snapshotResources(session);
    })
    .catch((error) => {
      console.error("Failed to bind extensions", sessionId, error);
      channel.state.resources = snapshotResources(session);
    });
  return channel;
};

const detachListener = (sessionId: string, ws: BunWS) => {
  const channel = channelsBySession.get(sessionId);
  if (!channel) return;
  channel.sockets.delete(ws);
  if (channel.sockets.size !== 0) return;
  void channel.ready.then(() => {
    if (channelsBySession.get(sessionId) !== channel || channel.sockets.size !== 0) return;
    // 没有客户端在场了：取消挂起的扩展 UI 对话框，避免插件永久等待。
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

const sendError = (ws: BunWS, error: string) => {
  const msg: ServerMessage = { type: "error", error };
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

export const sessionWsHandler: WsHandler = {
  async open(ws) {
    const bunWS = ws as BunWS;
    const { sessionId } = bunWS.data;
    bunWS.data.closed = false;
    const session = await getSession(sessionId);
    if (bunWS.data.closed) {
      if (!channelsBySession.has(sessionId)) {
        deactivateSession(sessionId).catch((error) => {
          console.error("Failed to deactivate session", sessionId, error);
        });
      }
      return;
    }
    if (!session) {
      sendError(bunWS, "session not found");
      bunWS.close();
      return;
    }
    const channel = attachListener(sessionId, session);
    channel.sockets.add(bunWS);
    bunWS.data.attached = true;
    await channel.ready;
    if (bunWS.data.closed || !bunWS.data.attached) return;
    try {
      const { model, availableModels } = await getEffectiveModelDescriptor(session);
      channel.state.model = model;
      channel.state.availableModels = availableModels;
      channel.state.thinking = getThinkingState(session);
      // Seed the Context pane's view before the first snapshot. Computed
      // after the model is known so the contextWindow is accurate.
      channel.state.stats = computeSessionStatsView(session);
    } catch (error) {
      console.error("Failed to load model snapshot", sessionId, error);
    }
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
    const session = await getSession(sessionId);
    if (bunWS.data.closed) return;
    if (!session) {
      sendError(bunWS, "session not found");
      return;
    }
    switch (input.type) {
      case "prompt": {
        if (typeof input.message !== "string") {
          sendError(bunWS, "prompt message must be a string");
          return;
        }
        // 发送前展开消息里的 @path 引用（对齐原生 TUI）：图片 → images
        // 附件，其他 → <file> 块；解析不了的 @ 保留原样。
        const { text, images } = await expandFileRefs(input.message, session.sessionManager.getCwd());
        if (bunWS.data.closed) return;
        const streamingBehavior =
          input.streamingBehavior === "steer" || input.streamingBehavior === "followUp"
            ? input.streamingBehavior
            : session.isStreaming
              ? "steer"
              : undefined;
        // Fire-and-forget: prompt() runs until the retry/queue drains; events
        // flow back via subscribe().
        session
          .prompt(text, {
            ...(images.length > 0 ? { images } : {}),
            ...(streamingBehavior ? { streamingBehavior } : {}),
          })
          .finally(() => {
            const channel = channelsBySession.get(sessionId);
            if (!channel) return;
            channel.state.resources = snapshotResources(session);
            broadcastChannelState(channel, { resources: channel.state.resources });
          })
          .catch((err: unknown) =>
            sendError(bunWS, toMessage(err)),
          );
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
      case "set_model": {
        if (typeof input.provider !== "string" || typeof input.modelId !== "string") {
          sendError(bunWS, "set_model requires provider+modelId strings");
          return;
        }
        const target = session.modelRuntime.getModel(input.provider, input.modelId);
        if (!target) {
          sendError(bunWS, `Unknown model: ${input.provider}/${input.modelId}`);
          return;
        }
        try {
          await session.setModel(target);
          // setModel only emits events when the thinking level also changes;
          // broadcast unconditionally so the selector UI updates either way.
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
        // setThinkingLevel is a synchronous clamp; it just throws
        // (TypeError) for unsupported levels — which we surface as an
        // error frame.
        try {
          session.setThinkingLevel(input.level as Parameters<typeof session.setThinkingLevel>[0]);
          // Same reasoning as set_model: clamped-to-same-value calls emit
          // nothing, so broadcast explicitly.
          channelsBySession.get(sessionId)?.queueModelStateBroadcast();
        } catch (err) {
          sendError(bunWS, toMessage(err));
        }
        return;
      }
      case "resync": {
        // 客户端检测到 seq 间隙：给这个 socket 单独补发当前权威快照。
        const channel = channelsBySession.get(sessionId);
        if (channel && bunWS.readyState === 1) bunWS.send(JSON.stringify(snapshotMessage(channel)));
        return;
      }
      case "ui_response": {
        // 扩展 UI 应答：派发给挂起的对话框。
        const response = input.response as unknown;
        if (
          !response ||
          typeof response !== "object" ||
          typeof (response as { id?: unknown }).id !== "string"
        ) {
          sendError(bunWS, "ui_response requires an id");
          return;
        }
        channelsBySession.get(sessionId)?.uiBridge.handleResponse(response as RpcExtensionUIResponse);
        return;
      }
      default:
        // Unknown message types are ignored so clients can probe
        // forward-compat features without the server crashing them.
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
