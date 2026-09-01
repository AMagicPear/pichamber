/**
 * 会话 WS 协议与 pi 会话相关的 wire 类型。
 *
 * 只放「活会话」相关的东西：ServerMessage/ClientMessage 帧、会话显示状态
 * （activity/pending/model/thinking/stats/resources）、扩展 UI 原样转发帧。
 * 凡官方已有同构类型（AgentMessage/AgentSessionEvent/ImageContent/
 * WidgetPlacement/…）一律直接复用官方 import，不自造。
 * 提供商/配额/扩展设置见 `providers.ts`；git/fs/pty/服务端设置等
 * pichamber 自有功能见各自文件。
 */
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSessionEvent,
  JsonAgentSessionEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionInfo as PiSessionInfo,
  SlashCommandInfo,
  SlashCommandSource,
  SourceInfo,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";

/** A persisted Pi session enriched with the current availability of its cwd. */
export type SessionInfo = PiSessionInfo & {
  cwdAvailable: boolean;
};

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

/** Wire command shape for the slash-command shelf. Built-ins are defined
 *  client-side (`packages/web/src/composables/builtin-commands.ts`), so the
 *  server never emits `source: "builtin"` — but the widened union lets the
 *  client shelf type server commands and its own built-ins without casts.
 *  The client renders `source` as a label only and never branches on it. */
export type RuntimeSlashCommand = Omit<SlashCommandInfo, "source"> & {
  source: SlashCommandSource | "builtin";
};

export type RuntimeResources = {
  commands: RuntimeSlashCommand[];
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
  cost: number;
  lastAssistant: LastAssistantUsage;
  /** Comma-grouped render of `lastAssistant`, one string per bucket,
   *  for the same reason `messages.*Text` exists. */
  lastAssistantText: { [K in keyof LastAssistantUsage]: string };
  /** Cache hit rate, e.g. "99.4%". `cacheRead / (cacheRead + input)`. */
  cacheHit: string;
};

/** Ordered messages in the session stream. A client applies only this union
 * through its session reducer and requests a snapshot when sequence numbers
 * are not contiguous. */
export type ServerEventMessage = (AgentSessionEvent | JsonAgentSessionEvent) & { seq: number };

export type SequencedServerMessage =
  | {
      type: "snapshot";
      seq: number;
      /** 服务端在快照时刻计算的当前活动状态；运行中的增量变化由官方
       *  agent_start / agent_settled / compaction_* / auto_retry_start
       *  事件驱动，客户端自行派生。 */
      activity: AgentActivity;
      /** 服务端计算的排队消息（SDK 队列 + compaction 缓冲）；运行中的
       *  SDK 队列由官方 `queue_update` 事件直接派生。 */
      pending: PendingMessages;
      /** Whether pending messages can be removed and restored without
       * interrupting the current agent run. External Pi's public RPC
       * protocol has no equivalent clear-queue command. */
      canRestorePending: boolean;
      /** 官方会话消息模型：user/assistant/toolResult/custom/
       *  compactionSummary（含 compaction 摘要与 custom 消息）。 */
      messages: AgentMessage[];
      /** Pi 持久化 entry id，与 `messages` 同位置对齐。 */
      messageEntryIds: Array<string | undefined>;
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
      stats?: SessionStatsView;
      resources: RuntimeResources;
    }
  | {
      type: "state";
      seq: number;
      /** 服务端计算、事件流里无法直接派生的当前事实：model 清单、
       *  thinking 可用级别、stats、resources，以及 compaction 缓冲
       *  合并后的 pending。运行中的 activity 不在此列——它由官方事件派生。 */
      pending?: PendingMessages;
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
      stats?: SessionStatsView;
      resources?: RuntimeResources;
    }
  | ServerEventMessage;

/** The complete browser protocol. Extension UI requests, draft restores, and
 * errors are out-of-band effects, intentionally excluded from ordered state. */
export type ServerMessage =
  | SequencedServerMessage
  /** 扩展 UI 请求直接使用官方 RPC 形状；setWidget 的 widget 行解析由
   *  前端消费方负责——服务端不懂扩展的私有前缀协议）。 */
  | RpcExtensionUIRequest
  | { type: "draft_restore"; messages: string[] }
  | { type: "error"; error: string }
  | {
      type: "operation_result";
      operationId: string;
      operation: TrackedOperation;
      ok: boolean;
      /** Free-form success payload: only safe, server-known fields. */
      applied?: { [key: string]: unknown };
      /** When `ok` is false, a short, user-safe error message. Full stacks
       *  remain in the diagnostics log under the matching operationId. */
      error?: string;
    };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage =
  | { type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
  | { type: "abort"; restorePending?: boolean; operationId?: string }
  | { type: "restore_pending" }
  | { type: "compact"; customInstructions?: string; operationId?: string }
  | { type: "reload"; operationId?: string }
  | { type: "set_model"; provider: string; modelId: string; operationId?: string }
  | { type: "set_thinking_level"; level: ThinkingLevel; operationId?: string }
  | { type: "resync" }
  /** 扩展 UI 应答直接使用官方 RPC 形状。 */
  | RpcExtensionUIResponse;

/** Operations the server will ack with an `operation_result` so the browser
 *  can correlate user intent with state changes (especially useful when the
 *  user reports a state that "didn't stick" — the report tells us exactly
 *  which step failed). */
export type TrackedOperation =
  | "abort"
  | "compact"
  | "reload"
  | "set_model"
  | "set_thinking_level";
