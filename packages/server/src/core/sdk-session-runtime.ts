/**
 * SDK-backed session runtime.
 *
 * Wraps Pi's in-process `AgentSession` and forwards every call through.
 * The pass-throughs preserve the existing behaviour exactly: events,
 * commands, model state, and resource snapshots all come from the same
 * SDK surface `ws.ts` already relies on.
 */
import {
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionUIContext,
  type SessionEntry,
  type SessionInfo,
  type SessionManager,
  createAgentSession,
  getAgentDir,
  SessionManager as SessionManagerCtor,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  RuntimeClearedQueue,
  RuntimeModelDescriptor,
  RuntimeModelInfo,
  RuntimePromptOptions,
  RuntimeResources,
  SessionRuntime,
} from "./runtime";
import { providerName } from "../providers/providers";
import { getLastAssistantUsage } from "@earendil-works/pi-coding-agent";

const modelDescriptorFromAgentSession = (
  session: AgentSession,
  providerLabel: string,
): RuntimeModelDescriptor | undefined => {
  const model = session.model;
  if (!model) return undefined;
  return {
    provider: model.provider,
    providerName: providerLabel,
    id: model.id,
    name: model.name || model.id,
    reasoning: Boolean(model.reasoning),
    contextWindow: model.contextWindow ?? 0,
  };
};

const modelInfoFromAgentSession = (session: AgentSession): RuntimeModelInfo[] => {
  // The SDK's `getAvailableSnapshot()` returns Model<Api>[] which is
  // structurally a superset of ModelInfo; we project to the wire shape.
  try {
    const models = session.modelRuntime.getAvailableSnapshot();
    return models.map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow ?? 0,
      reasoning: Boolean(model.reasoning),
    }));
  } catch {
    return [];
  }
};

const snapshotResources = (session: AgentSession): RuntimeResources => {
  const result = session.resourceLoader.getExtensions();
  const activeTools = new Set(result.runtime.getActiveTools());
  const commands = session.settingsManager.getEnableSkillCommands()
    ? result.runtime.getCommands()
    : result.runtime.getCommands().filter((command) => command.source !== "skill");
  return {
    commands,
    tools: result.runtime.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      sourceInfo: tool.sourceInfo,
      active: activeTools.has(tool.name),
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
    extensionInventoryAvailable: true,
  };
};

export type SdkSessionRuntimeOptions = {
  cwd: string;
  sessionFile?: string;
};

export const createSdkSessionRuntime = async (
  options: SdkSessionRuntimeOptions,
): Promise<SessionRuntime> => {
  const { cwd, sessionFile } = options;
  // Open or create the underlying session manager. Both paths go
  // through `createAgentSession` so the runtime gets the full event
  // subscription + extension runner.
  const sessionManager: SessionManager = sessionFile
    ? SessionManagerCtor.open(sessionFile)
    : SessionManagerCtor.create(cwd);

  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    sessionManager,
  });

  const runtime: SessionRuntime = {
    type: "sdk",

    /** Internal hook: quota, persistence, and tests that need the raw
     *  SDK session reach through here. RPC runtimes don't expose this
     *  because the wire protocol doesn't carry a model runtime. The
     *  property is intentionally not part of the public `SessionRuntime`
     *  surface — see `runtime.ts` for the contract. */
    agentSession: session,
    get sessionId(): string {
      return session.sessionId;
    },
    get cwd(): string {
      return sessionManager.getCwd();
    },
    get sessionFile(): string | undefined {
      return session.sessionFile;
    },
    get isStreaming(): boolean {
      return session.isStreaming;
    },
    get isCompacting(): boolean {
      return session.isCompacting;
    },
    get supportsQueueRestore(): boolean {
      return true;
    },
    get thinkingLevel(): ThinkingLevel {
      return session.thinkingLevel;
    },

    dispose() {
      session.dispose();
    },

    subscribe(listener: (event: AgentSessionEvent) => void) {
      return session.subscribe(listener);
    },

    async prompt(message: string, options?: RuntimePromptOptions) {
      const images: ImageContent[] | undefined = options?.images?.map((image) => ({
        type: "image",
        mimeType: image.mimeType,
        data: image.data,
      }));
      await session.prompt(message, {
        streamingBehavior: options?.streamingBehavior,
        images,
      });
    },
    async steer(message: string) {
      await session.steer(message);
    },
    async followUp(message: string) {
      await session.followUp(message);
    },
    async abort() {
      await session.abort();
    },
    async compact(customInstructions?: string) {
      return session.compact(customInstructions);
    },
    async setModel(provider: string, modelId: string) {
      const target = session.modelRuntime.getModel(provider, modelId);
      if (!target) throw new Error(`Unknown model: ${provider}/${modelId}`);
      await session.setModel(target);
    },
    setThinkingLevel(level: ThinkingLevel) {
      session.setThinkingLevel(level);
      return Promise.resolve();
    },
    clearQueue(): RuntimeClearedQueue {
      return session.clearQueue();
    },

    getAvailableModels(): Promise<RuntimeModelInfo[]> {
      return Promise.resolve(modelInfoFromAgentSession(session));
    },
    getAvailableThinkingLevels(): ThinkingLevel[] {
      return session.getAvailableThinkingLevels();
    },
    getActiveToolNames(): string[] {
      return session.getActiveToolNames();
    },

    getProviderName(providerId: string): string {
      return providerName(session, providerId);
    },
    getProviderBaseUrl(providerId: string): string | undefined {
      const provider = session.modelRuntime.getProvider(providerId);
      return provider?.baseUrl;
    },
    getProviderApiType(providerId: string): string | undefined {
      const provider = session.modelRuntime.getProvider(providerId);
      return provider?.getModels()[0]?.api as string | undefined;
    },
    getCurrentModel(): RuntimeModelDescriptor | undefined {
      const model = session.model;
      if (!model) return undefined;
      return modelDescriptorFromAgentSession(session, providerName(session, model.provider));
    },

    async getResources(): Promise<RuntimeResources> {
      return snapshotResources(session);
    },

    async buildConversationEntries(): Promise<SessionEntry[]> {
      return sessionManager.buildContextEntries();
    },

    async getSessionStats() {
      return session.getSessionStats();
    },

    async getSessionInfo(): Promise<SessionInfo | null> {
      return {
        id: session.sessionId,
        path: session.sessionFile ?? "",
        cwd: sessionManager.getCwd(),
        name: session.sessionName,
        created: new Date(0),
        modified: new Date(),
        messageCount: session.state.messages.length,
        firstMessage: "",
        allMessagesText: "",
      };
    },

    async bindExtensions(uiContext: ExtensionUIContext) {
      await session.bindExtensions({ uiContext, mode: "rpc" });
    },
  };

  return runtime;
};

// Re-exported for code that still needs the raw last-assistant usage
// (the context panel pre-computes display strings from these numbers).
export { getLastAssistantUsage };
