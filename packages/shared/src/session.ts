/**
 * 会话 WS 协议与 pi 会话相关的 wire 类型。
 *
 * 只放「活会话」相关的东西：ServerMessage/ClientMessage 帧、会话显示状态
 * （activity/pending/model/thinking/stats/resources）、扩展 UI 归一化类型。
 * 凡官方已有同构类型（AgentMessage/AgentSessionEvent/ImageContent/
 * WidgetPlacement/…）一律直接复用官方 import，不自造。
 * 提供商/配额/扩展设置见 `providers.ts`；git/fs/pty/服务端设置等
 * pichamber 自有功能见各自文件。
 */
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSessionEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SlashCommandInfo,
  SourceInfo,
  WidgetPlacement,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";

/** Composer 状态行的"当前在干嘛"，与 TUI 的 `StatusIndicatorKind`
 *  （working/retry/compaction/branchSummary）+ `IdleStatus` 一一对应。
 *  thinking/responding/tool 等细粒度状态不在这里 —— 它们由会话消息流
 *  自己渲染（流式回复 / running 工具卡片），对应 TUI 的
 *  streamingComponent / ToolExecutionComponent 就地渲染，不入 activity。
 *  branchSummary 等我们有分支流程时再加。 */
export type AgentActivity =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "retrying"; attempt: number; maxAttempts: number }
  | { phase: "compacting" };

/** 排队中的消息（steer/followUp），与官方 queue_update 事件同构。 */
export type PendingMessages = {
  steering: string[];
  followUp: string[];
};

export type RuntimeToolInfo = {
  name: string;
  description: string;
  active: boolean;
  sourceInfo: SourceInfo;
};

export type ExtensionInfo = {
  path: string;
  sourceInfo: SourceInfo;
  commands: string[];
  tools: string[];
};

export type ActivityNode = {
  id: string;
  kind: "subagent" | "workflow" | "step";
  label: string;
  state: string;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  activity?: {
    state?: string;
    currentTool?: string;
    lastActivityAt?: number;
    currentToolStartedAt?: number;
    turnCount?: number;
    toolCount?: number;
  };
  children?: ActivityNode[];
};

/** 浏览器侧归一化的扩展 widget 内容（官方 ExtensionWidgetOptions 只有
 *  placement，widget 正文是 pichamber 的 wire 形状）。 */
export type ExtensionWidget =
  | { kind: "lines"; lines: string[] }
  | { kind: "task-tree"; runs: ActivityNode[]; omitted?: number };

export type WebExtensionUIRequest = Exclude<RpcExtensionUIRequest, { method: "setWidget" }> | {
  type: "extension_ui_request";
  id: string;
  method: "setWidget";
  widgetKey: string;
  widget?: ExtensionWidget;
  widgetPlacement?: WidgetPlacement;
};

export type RuntimeResources = {
  commands: SlashCommandInfo[];
  tools: RuntimeToolInfo[];
  extensions: ExtensionInfo[];
  diagnostics: Array<{ path: string; error: string }>;
  /** False when the active runtime cannot enumerate extension/tool resources. */
  extensionInventoryAvailable: boolean;
};

/** Slim model reference the server emits and accepts on the wire.
 *  We don't ship the full Model<Api> because the pi-ai type erases to
 *  Model<Api> and the wire only cares about provider/id + display info. */
export type ModelDescriptor = {
  /** Pi provider id (e.g. "minimax-cn"). Used for routing/logo lookup. */
  provider: string;
  /** Human-readable provider name from Pi's registry (e.g. "MiniMax"). */
  providerName: string;
  id: string;
  /** Display name; falls back to id when the model registry has no friendly name. */
  name: string;
  /** Whether the model supports extended thinking. */
  reasoning: boolean;
};

export type ThinkingState = {
  level: ThinkingLevel;
  /** Levels the current model accepts. The server re-evaluates on model change. */
  availableLevels: ThinkingLevel[];
};

/** Per-message usage breakdown for the most recent assistant turn. Numbers
 *  are the raw token counts the provider reported; the client renders them
 *  via `Intl.NumberFormat`. */
export type LastAssistantUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Pre-computed, ready-to-render session stats. The server builds this from
 *  pi's `AgentSession` so the client doesn't have to duplicate the
 *  formatting (date, percent, cost, cache hit, etc.). Display strings are
 *  already produced; the view also carries the raw values so the client
 *  can re-format if it ever needs to. */
export type SessionStatsView = {
  /** Active model descriptor; mirrors the standalone `state.model` field
   *  but bundled so the Context pane can render without an extra lookup. */
  model: ModelDescriptor | undefined;
  /** Localized "Jul 20, 2026, 9:10 AM" string; empty when no entry has
   *  been recorded yet. */
  modified: string;
  context: {
    /** Estimated context tokens; null when unknown (e.g. right after a
     *  compaction, before the next assistant turn reports usage). */
    tokens: number | null;
    contextWindow: number;
    /** "0.0%"–"100.0%" formatted to one decimal; null while `tokens` is null. */
    percent: string | null;
    /** Comma-grouped token count, e.g. "95,881"; "—" while unknown. */
    tokensText: string;
  };
  messages: {
    total: number;
    user: number;
    assistant: number;
    /** Comma-grouped render of each count, e.g. "1,234". The server owns
     *  the formatting so the client doesn't need a locale-specific
     *  number formatter (project rule: display strings come from the
     *  server). */
    totalText: string;
    userText: string;
    assistantText: string;
  };
  cost: { value: string; raw: number };
  lastAssistant: LastAssistantUsage;
  /** Comma-grouped render of `lastAssistant`, one string per bucket,
   *  for the same reason `messages.*Text` exists. */
  lastAssistantText: { [K in keyof LastAssistantUsage]: string };
  /** Cache hit rate, e.g. "99.4%". `cacheRead / (cacheRead + input)`. */
  cacheHit: string;
};

/** JSON messages the server sends to session WebSocket clients.
 *  每个消息都携带单调递增的 seq；客户端发现 seq 不连续即请求 resync。
 *
 *  会话内容直接复用官方的 `AgentSessionEvent` 事件流（`event` 帧）与
 *  `AgentMessage` 消息模型（`snapshot.messages`），不再自造 item 协议；
 *  其余帧只承载服务器算好的显示状态（model/stats/resources…）。 */
export type ServerMessage =
  | {
      type: "snapshot";
      seq: number;
      busy: boolean;
      activity: AgentActivity;
      pending: PendingMessages;
      /** Whether pending messages can be removed and restored without
       * interrupting the current agent run. External Pi's public RPC
       * protocol has no equivalent clear-queue command. */
      canRestorePending: boolean;
      /** 官方会话消息模型：user/assistant/toolResult/custom/
       *  compactionSummary（含 compaction 摘要与 custom 消息）。 */
      messages: AgentMessage[];
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
      stats?: SessionStatsView;
      resources: RuntimeResources;
    }
  /** 官方会话事件原样转发（message_start/update/end、
   *  tool_execution_*、queue_update、agent_start/settled、compaction_*、
   *  auto_retry_*、entry_appended…）。 */
  | { type: "event"; seq: number; event: AgentSessionEvent }
  | {
      type: "state";
      seq: number;
      busy?: boolean;
      activity?: AgentActivity;
      pending?: PendingMessages;
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
      stats?: SessionStatsView;
      resources?: RuntimeResources;
    }
  /** Extension UI request normalized for browser rendering. */
  | { type: "ui_request"; request: WebExtensionUIRequest }
  | { type: "draft_restore"; messages: string[] }
  | { type: "error"; error: string };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage =
  | { type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
  | { type: "abort"; restorePending?: boolean }
  | { type: "restore_pending" }
  | { type: "compact"; customInstructions?: string }
  | { type: "reload" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "resync" }
  /** 扩展 UI 应答（官方 RPC 模式 extension_ui_response 帧原样转发）。 */
  | { type: "ui_response"; response: RpcExtensionUIResponse };
