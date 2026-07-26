import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentSessionEvent,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionTreeNode,
} from "@earendil-works/pi-coding-agent";

export type {
  AgentMessage,
  AgentSessionEvent,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionTreeNode,
};

/** JSON messages the server sends to session WebSocket clients. */
export type ServerMessage =
  | { type: "ready"; sessionId: string; entries: SessionEntry[] }
  | { type: "error"; error: string }
  | { type: "event"; event: AgentSessionEvent };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage = { type: "prompt"; message: string };

export interface SessionSnapshot {
  header: SessionHeader | null;
  entries: SessionEntry[];
  branch: SessionEntry[];
  tree: SessionTreeNode[];
  leafId: string | null;
  name?: string;
}
