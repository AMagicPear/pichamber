import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { fileURLToPath } from "node:url";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  buildContextEntries,
  RpcClient,
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

export type SessionDriverMode = "sdk" | "rpc";

export type PromptOptions = {
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";
};

export type SessionSnapshot = {
  messages: AgentMessage[];
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  thinking: ThinkingState;
  stats: SessionStatsView;
  activity: AgentActivity;
  pending: PendingMessages;
};

export interface SessionDriver {
  readonly mode: SessionDriverMode;
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly cwd: string;

  start(): Promise<void>;
  dispose(): Promise<void>;
  abort(): Promise<void>;

  getSnapshot(): Promise<SessionSnapshot>;
  prompt(message: string, options?: PromptOptions): Promise<void>;
  compact(customInstructions?: string): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;

  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}
const emptyUsage = () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
const numberFormat = new Intl.NumberFormat("en-US");
const formatPercent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

const descriptor = (model: { provider: string; id: string; name?: string; reasoning?: boolean }, name = model.provider): ModelDescriptor => ({
  provider: model.provider,
  providerName: name,
  id: model.id,
  name: model.name || model.id,
  reasoning: Boolean(model.reasoning),
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
  const lastAssistant = emptyUsage();
  return {
    model,
    modified: "",
    context: {
      tokens: stats.contextUsage?.tokens ?? null,
      contextWindow: stats.contextUsage?.contextWindow ?? 0,
      percent: stats.contextUsage?.percent == null ? null : formatPercent(stats.contextUsage.percent / 100),
      tokensText: stats.contextUsage?.tokens == null ? "—" : numberFormat.format(stats.contextUsage.tokens),
    },
    messages: {
      total: stats.totalMessages,
      user: stats.userMessages,
      assistant: stats.assistantMessages,
      totalText: numberFormat.format(stats.totalMessages),
      userText: numberFormat.format(stats.userMessages),
      assistantText: numberFormat.format(stats.assistantMessages),
    },
    cost: stats.cost,
    lastAssistant,
    lastAssistantText: { input: "0", output: "0", reasoning: "0", cacheRead: "0", cacheWrite: "0" },
    cacheHit: totalRead > 0 ? formatPercent(stats.tokens.cacheRead / totalRead) : "0.0%",
  };
};

const sdkMessages = (session: AgentSession) =>
  buildContextEntries(session.sessionManager.buildContextEntries()).flatMap(sessionEntryToContextMessages);

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
    return {
      messages: sdkMessages(session),
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
    const [state, messages, available, stats, levels] = await Promise.all([
      client.getState(),
      client.getMessages(),
      client.getAvailableModels(),
      client.getSessionStats(),
      client.getAvailableThinkingLevels(),
    ]);
    const model = state.model ? descriptor(state.model) : undefined;
    const availableModels = available.map(rpcModelDescriptor);
    return {
      messages,
      model,
      availableModels,
      thinking: { level: state.thinkingLevel, availableLevels: levels },
      stats: rpcStatsView(stats, model),
      activity: state.isCompacting ? { phase: "compacting" } : state.isStreaming ? { phase: "working" } : { phase: "idle" },
      pending: { steering: [], followUp: [] },
    };
  }

  async prompt(message: string, options?: PromptOptions) {
    const client = this.rpcClient;
    if (options?.streamingBehavior === "steer") return client.steer(message, options.images);
    if (options?.streamingBehavior === "followUp") return client.followUp(message, options.images);
    return client.prompt(message, options?.images);
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
      if (event.type === "extension_ui_request") {
        const method = event.method;
        if (method === "notify" || method === "setStatus" || method === "setWidget" || method === "setTitle") {
          listener(event as unknown as AgentSessionEvent);
        } else listener(event as unknown as AgentSessionEvent);
        return;
      }
      listener(event as AgentSessionEvent);
    });
  }
}
