import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent, SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";

export type {
  AgentMessage,
  AgentSessionEvent,
  SessionEntry,
  SessionInfo,
};

type ToolExecutionStartEvent = Extract<AgentSessionEvent, { type: "tool_execution_start" }>;
type ToolExecutionUpdateEvent = Extract<AgentSessionEvent, { type: "tool_execution_update" }>;
type ToolExecutionEndEvent = Extract<AgentSessionEvent, { type: "tool_execution_end" }>;

export type LiveToolExecution = Pick<ToolExecutionStartEvent, "toolCallId" | "toolName" | "args"> & {
  result?: ToolExecutionUpdateEvent["partialResult"] | ToolExecutionEndEvent["result"];
  isError?: ToolExecutionEndEvent["isError"];
  running: boolean;
};

/** Pi's `sessionEntryToContextMessages()` projection with the source entry identity retained for Vue. */
export type ConversationTranscriptMessage = {
  id: string;
  message: AgentMessage;
};

export type LiveConversationState = {
  pendingUserMessages: AgentMessage[];
  streamingMessage?: AgentMessage;
  toolExecutions: LiveToolExecution[];
};

/** Slim model reference the server emits and accepts on the wire.
 *  We don't ship the full Model<Api> because the pi-ai type erases to
 *  Model<Api> and the wire only cares about provider/id + display info. */
export type ModelDescriptor = {
  provider: string;
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

/** JSON messages the server sends to session WebSocket clients. */
export type ServerMessage =
  | {
      type: "ready";
      sessionId: string;
      messages: ConversationTranscriptMessage[];
      live: LiveConversationState;
      model: ModelDescriptor | undefined;
      availableModels: ModelDescriptor[];
      thinking: ThinkingState;
    }
  | { type: "messages"; messages: ConversationTranscriptMessage[] }
  | { type: "live"; live: LiveConversationState }
  | {
      type: "model_state";
      model: ModelDescriptor | undefined;
      availableModels: ModelDescriptor[];
      thinking: ThinkingState;
    }
  | { type: "error"; error: string };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage =
  | { type: "prompt"; message: string }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel };
