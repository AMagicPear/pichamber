import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { fileURLToPath } from "node:url";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  buildContextEntries,
  RpcClient,
  SessionManager,
  sessionEntryToContextMessages,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type JsonAgentSessionEvent,
  type ModelInfo,
  type RpcExtensionUIResponse,
  type SessionStats,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentActivity,
  ModelDescriptor,
  PendingMessages,
  SessionStatsView,
  ThinkingState,
} from "@amagicpear/pichamber-shared";
import { providerName } from "../providers/providers";
import { computeSessionStatsView } from "./context";

const piCliPath = fileURLToPath(
  new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")),
);

/** How pichamber executes Pi. This is independent from the extension UI host. */
export type PiExecutionBackend = "sdk" | "rpc";

export type PromptOptions = {
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
};

export type SessionSnapshot = {
  messages: AgentMessage[];
  /** Pi session entry ids aligned with `messages`; display-only entries use
   * `undefined`, while persisted user/assistant entries can be fork targets. */
  messageEntryIds: Array<string | undefined>;
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  thinking: ThinkingState;
  stats: SessionStatsView;
  activity: AgentActivity;
  pending: PendingMessages;
};

export interface SessionDriver {
  readonly mode: PiExecutionBackend;
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly cwd: string;

  start(): Promise<void>;
  dispose(): Promise<void>;
  abort(): Promise<void>;

  getSnapshot(): Promise<SessionSnapshot>;
  prompt(message: string, options?: PromptOptions): Promise<void>;
  /** Resume a turn that ended in abort/error/truncation instead of a normal stop. */
  continue(): Promise<void>;
  compact(customInstructions?: string): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;

  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}
const emptyUsage = () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

const descriptor = (model: { provider: string; id: string; name?: string; reasoning?: boolean; input?: Array<"text" | "image"> }, name = model.provider): ModelDescriptor => ({
  provider: model.provider,
  providerName: name,
  id: model.id,
  name: model.name || model.id,
  reasoning: Boolean(model.reasoning),
  input: model.input,
});

const sdkModelState = (session: AgentSession) => {
  const availableModels = session.modelRuntime.getAvailableSnapshot().map((model) =>
    descriptor(model, providerName(session, model.provider) || model.provider),
  );
  const current = session.model;
  if (!current) return { model: undefined, availableModels };
  const currentDescriptor = descriptor(current, providerName(session, current.provider) || current.provider);
  const match = availableModels.find((model) => model.provider === current.provider && model.id === current.id);
  return { model: match ? { ...match, name: current.name || match.name } : currentDescriptor, availableModels };
};

const rpcStatsView = (stats: SessionStats, model: ModelDescriptor | undefined): SessionStatsView => {
  const totalRead = stats.tokens.cacheRead + stats.tokens.input;
  return {
    model,
    modified: null,
    context: {
      tokens: stats.contextUsage?.tokens ?? null,
      contextWindow: stats.contextUsage?.contextWindow ?? 0,
      percent: stats.contextUsage?.percent == null ? null : stats.contextUsage.percent / 100,
    },
    messages: {
      total: stats.totalMessages,
      user: stats.userMessages,
      assistant: stats.assistantMessages,
    },
    cost: stats.cost,
    lastAssistant: emptyUsage(),
    cacheHit: totalRead > 0 ? stats.tokens.cacheRead / totalRead : null,
  };
};

const sessionMessages = (sessionManager: SessionManager) => {
  const entries = buildContextEntries(sessionManager.buildContextEntries());
  return {
    messages: entries.flatMap(sessionEntryToContextMessages),
    messageEntryIds: entries.flatMap((entry) =>
      sessionEntryToContextMessages(entry).map(() => entry.type === "message" ? entry.id : undefined),
    ),
  };
};

/** 被中断的助手回复：只有这些回复值得重跑。 */
const isInterrupted = (message: AgentMessage) =>
  message.role === "assistant" &&
  (message.stopReason === "aborted" || message.stopReason === "error" || message.stopReason === "length");

/**
 * 把失败的那次尝试整组从模型上下文里剔除：助手消息与它产生的工具结果必须成对移除。
 * 只删助手消息会留下没有对应调用的工具结果，之后的每个请求都会被上游拒绝。
 */
const omitFailedAttempt = (manager: SessionManager, entryId: string, message: AgentMessage) => {
  const toolCallIds = new Set(
    message.role === "assistant"
      ? message.content.flatMap((block) => (block.type === "toolCall" ? [block.id] : []))
      : [],
  );
  manager.appendContextEdit(entryId, null);
  for (const entry of manager.getBranch()) {
    if (entry.type !== "message") continue;
    const candidate = entry.message;
    if (candidate.role === "toolResult" && toolCallIds.has(candidate.toolCallId)) {
      manager.appendContextEdit(entry.id, null);
    }
  }
};

/**
 * Pi 1.4 移除了会话私有的 `_runAgentPrompt([])`：会话的运行体现在只能由用户消息或自定义消息
 * 触发，而自定义消息会被官方 `convertToLlm` 转成新的 user 输入，污染这次重试的请求。
 * 这里用 core agent 公开的 `continue()` 重建请求（等价于重跑被中断的那一轮），并按官方
 * `_startRun` 的顺序补齐收尾：失败恢复、溢出压缩重试、settle 边界与 `agent_settled`。
 * 上游一旦提供公开的会话级 continue 入口，这段 shim 即可整体删除。
 */
type ContinuedTurnInternals = {
  _isAgentRunActive: boolean;
  _agentRunAbortRequested: boolean;
  _failedResponse: unknown;
  _handlePostAgentRun(): Promise<boolean>;
  _runBeforeSettleBoundary(): Promise<boolean>;
  _emitAgentSettled(): Promise<void>;
};

const continueTurn = async (session: AgentSession) => {
  const internals = session as unknown as ContinuedTurnInternals;
  internals._agentRunAbortRequested = false;
  internals._failedResponse = undefined;
  internals._isAgentRunActive = true;
  try {
    await session.agent.continue();
    while (!internals._agentRunAbortRequested) {
      if (await internals._handlePostAgentRun()) {
        if (internals._agentRunAbortRequested) break;
        await session.agent.continue();
        continue;
      }
      if (internals._agentRunAbortRequested || !(await internals._runBeforeSettleBoundary())) break;
      if (internals._agentRunAbortRequested) break;
      await session.agent.continue();
    }
  } finally {
    await internals._emitAgentSettled();
  }
};

export class SdkSessionDriver implements SessionDriver {
  readonly mode = "sdk" as const;
  private runtime: AgentSessionRuntime | null = null;

  constructor(
    readonly sessionId: string,
    readonly sessionFile: string,
    readonly cwd: string,
    private readonly createRuntime: () => Promise<AgentSessionRuntime>,
  ) {}

  get session() {
    if (!this.runtime) throw new Error("SDK session is not started");
    return this.runtime.session;
  }

  get runtimeValue() {
    return this.runtime;
  }

  async start() {
    this.runtime = await this.createRuntime();
  }

  async dispose() {
    const runtime = this.runtime;
    this.runtime = null;
    if (runtime) await runtime.dispose();
  }

  abort() {
    return this.session.abort();
  }

  async getSnapshot(): Promise<SessionSnapshot> {
    const session = this.session;
    const { model, availableModels } = sdkModelState(session);
    const persisted = sessionMessages(session.sessionManager);
    // 流式中的消息只挂在 agent state、尚未落盘到 session 文件；把它附在
    // 快照尾部，重连到运行中的会话时客户端才能无缝续上流式回复。
    const streaming = session.agent.state.streamingMessage;
    return {
      messages: streaming ? [...persisted.messages, streaming] : persisted.messages,
      messageEntryIds: streaming ? [...persisted.messageEntryIds, undefined] : persisted.messageEntryIds,
      model,
      availableModels,
      thinking: { level: session.thinkingLevel, availableLevels: session.getAvailableThinkingLevels() },
      stats: await computeSessionStatsView(this.runtime!),
      activity: session.isCompacting ? { phase: "compacting" } : session.isStreaming ? { phase: "working" } : { phase: "idle" },
      pending: { steering: [...session.getSteeringMessages()], followUp: [...session.getFollowUpMessages()] },
    };
  }

  prompt(message: string, options?: PromptOptions) {
    return this.session.prompt(message, options);
  }

  /** Resume without appending another user message; preserve failed attempts in raw history. */
  async continue() {
    const session = this.session;
    if (session.isStreaming) throw new Error("Cannot continue while a run is in progress");
    if (session.isCompacting) throw new Error("Cannot continue while compaction is in progress");
    const manager = session.sessionManager;
    const contributions = manager
      .buildSessionProjection()
      .entries.filter((entry) => entry.messages.some((message) => message.role !== "system"));
    const lastContribution = contributions.at(-1);
    const last = lastContribution?.messages.findLast((message) => message.role !== "system");
    if (!last) throw new Error("Nothing to continue from an empty session");
    if (last.role === "assistant") {
      if (!isInterrupted(last)) throw new Error("The last turn completed; there is nothing to continue");
      omitFailedAttempt(manager, lastContribution!.sourceEntry.id, last);
    } else if (last.role === "toolResult") {
      // 工具结果留在末尾说明助手消息已被剔除或是被中断的尝试：同样要把这次尝试整组清掉，
      // 否则重跑时请求里会残留没有对应调用的工具结果。
      const attempt = contributions
        .findLast((entry) => entry.messages.some((message) => message.role === "assistant"));
      const assistant = attempt?.messages.findLast((message) => message.role === "assistant");
      if (attempt && assistant && isInterrupted(assistant)) {
        omitFailedAttempt(manager, attempt.sourceEntry.id, assistant);
      }
    }
    session.refreshContext();
    await continueTurn(session);
  }

  compact(customInstructions?: string) {
    return this.session.compact(customInstructions).then(() => undefined);
  }

  async setModel(provider: string, modelId: string) {
    const model = this.session.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
    await this.session.setModel(model);
  }

  async setThinkingLevel(level: ThinkingLevel) {
    this.session.setThinkingLevel(level);
  }

  subscribe(listener: (event: AgentSessionEvent) => void) {
    return this.session.subscribe(listener);
  }

  respondExtensionUi(_response: RpcExtensionUIResponse) {
    throw new Error("Extension UI responses belong to the SDK UI bridge");
  }

  clearQueue() {
    return this.session.clearQueue();
  }

  reload() {
    return this.session.reload();
  }
}
const rpcModelDescriptor = (model: ModelInfo) => descriptor(model);

type RpcSessionTarget = {
  sessionId: string;
  sessionFile?: string;
  cwd: string;
};

export class RpcSessionDriver implements SessionDriver {
  readonly mode = "rpc" as const;
  private client: RpcClient | null = null;
  private currentSessionFile: string | undefined;
  readonly sessionId: string;
  readonly cwd: string;

  constructor(
    target: RpcSessionTarget,
    private readonly createClient: (options: ConstructorParameters<typeof RpcClient>[0]) => RpcClient = (options) => new RpcClient(options),
  ) {
    this.sessionId = target.sessionId;
    this.currentSessionFile = target.sessionFile;
    this.cwd = target.cwd;
  }

  get sessionFile() {
    if (!this.currentSessionFile) throw new Error("RPC session is not started");
    return this.currentSessionFile;
  }

  get rpcClient() {
    if (!this.client) throw new Error("RPC session is not started");
    return this.client;
  }

  async start() {
    const client = this.createClient({
      cliPath: piCliPath,
      cwd: this.cwd,
      args: this.currentSessionFile
        ? ["--session", this.currentSessionFile]
        : ["--session-id", this.sessionId],
    });
    this.client = client;
    try {
      await client.start();
      const state = await client.getState();
      if (state.sessionId !== this.sessionId) {
        throw new Error(`RPC session id mismatch: expected ${this.sessionId}, received ${state.sessionId}`);
      }
      if (!state.sessionFile) throw new Error("Pi RPC did not create a session file");
      this.currentSessionFile = state.sessionFile;
    } catch (error) {
      this.client = null;
      await client.stop().catch(() => undefined);
      throw error;
    }
  }

  async dispose() {
    const client = this.client;
    this.client = null;
    if (client) await client.stop();
  }

  abort() {
    return this.rpcClient.abort();
  }

  async getSnapshot(): Promise<SessionSnapshot> {
    const client = this.rpcClient;
    const [state, , available, stats, levels] = await Promise.all([
      client.getState(),
      client.getMessages(),
      client.getAvailableModels(),
      client.getSessionStats(),
      client.getAvailableThinkingLevels(),
    ]);
    const model = state.model ? descriptor(state.model) : undefined;
    const availableModels = available.map(rpcModelDescriptor);
    return {
      ...sessionMessages(SessionManager.open(this.sessionFile)),
      model,
      availableModels,
      thinking: { level: state.thinkingLevel, availableLevels: levels },
      stats: rpcStatsView(stats, model),
      activity: state.isCompacting ? { phase: "compacting" } : state.isStreaming ? { phase: "working" } : { phase: "idle" },
      pending: { steering: [], followUp: [] },
    };
  }

  /** The RPC client reports how the input was taken (`started` / `queued` / `handled`);
   * pichamber reads the outcome from the event stream, so the disposition is dropped. */
  async prompt(message: string, options?: PromptOptions) {
    const client = this.rpcClient;
    if (options?.streamingBehavior === "steer") await client.steer(message, options.images);
    else if (options?.streamingBehavior === "followUp") await client.followUp(message, options.images);
    else await client.prompt(message, options?.images);
  }

  continue() {
    return Promise.reject(new Error("Continuing an interrupted turn is only supported by the SDK runtime."));
  }

  compact(customInstructions?: string) {
    return this.rpcClient.compact(customInstructions).then(() => undefined);
  }

  setModel(provider: string, modelId: string) {
    return this.rpcClient.setModel(provider, modelId).then(() => undefined);
  }

  setThinkingLevel(level: ThinkingLevel) {
    return this.rpcClient.setThinkingLevel(level);
  }

  respondExtensionUi(response: RpcExtensionUIResponse) {
    // RpcClient exposes command helpers but no method for the protocol's
    // response-only extension frame. This command deliberately has no RPC
    // response, so using its private request helper would leak a pending
    // promise. Write the documented JSONL frame directly instead.
    const process = (this.rpcClient as unknown as {
      process?: { stdin?: { writable?: boolean; write: (data: string) => boolean } };
    }).process;
    if (!process?.stdin?.writable) throw new Error("RPC session stdin is not writable");
    process.stdin.write(`${JSON.stringify(response)}\n`);
  }

  subscribe(listener: (event: AgentSessionEvent) => void) {
    return this.rpcClient.onEvent((event: JsonAgentSessionEvent | { type: "extension_ui_request"; [key: string]: unknown }) => {
      // SessionChannel owns the sole protocol split for extension UI requests.
      // Keeping the SDK/RPC adapter transparent preserves Pi's original shape.
      listener(event as AgentSessionEvent);
    });
  }
}
