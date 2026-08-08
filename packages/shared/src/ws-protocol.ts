import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent, SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";

export type {
  AgentMessage,
  AgentSessionEvent,
  SessionEntry,
  SessionInfo,
};

/** One transparent record shape for persisted session entries and live Pi events. */
export type ConversationMessage = {
  id: string;
  timestamp: string;
  payload: SessionEntry | AgentSessionEvent;
};

/** JSON messages the server sends to session WebSocket clients. */
export type ServerMessage =
  | { type: "ready"; sessionId: string; messages: ConversationMessage[] }
  | { type: "message"; message: ConversationMessage }
  | { type: "error"; error: string };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage = { type: "prompt"; message: string };
