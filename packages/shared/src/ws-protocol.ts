import type { AgentMessage } from "@earendil-works/pi-agent-core";
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

/** JSON messages the server sends to session WebSocket clients. */
export type ServerMessage =
  | { type: "ready"; sessionId: string; messages: ConversationTranscriptMessage[]; live: LiveConversationState }
  | { type: "messages"; messages: ConversationTranscriptMessage[] }
  | { type: "live"; live: LiveConversationState }
  | { type: "error"; error: string };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage = { type: "prompt"; message: string };
