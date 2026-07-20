// ─── Re-exports from Pi packages (single source of truth) ──────────────────

// pi-ai: content blocks, messages, model thinking
import type {
  ModelThinkingLevel,
} from "@earendil-works/pi-ai";

export type {
  ThinkingLevel,
  ModelThinkingLevel,
  ThinkingLevelMap,
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  Usage,
  StopReason,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Message,
  AssistantMessageEvent,
} from "@earendil-works/pi-ai";

// Model<T> — pichamber UI doesn't need typed API, alias to Model<any>
import type { Model as PiModel } from "@earendil-works/pi-ai";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Model = PiModel<any>;

// pi-ai runtime helpers
export { getSupportedThinkingLevels, clampThinkingLevel } from "@earendil-works/pi-ai";

// pi-agent-core: agent-level types
export type { AgentMessage, AgentEvent } from "@earendil-works/pi-agent-core";

// pi-coding-agent: session-level types
export type {
  AgentSessionEvent,
  RpcSessionState,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";

// EXTENDED_THINKING_LEVELS — internal to pi-ai (not exported from the package)
export const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
];

// RuntimeEvent — pichamber wraps Pi's AgentSessionEvent with a catch-all so
// extra event types (model_select, extension_error, error, etc.) are accepted.
import type { AgentSessionEvent as PiAgentSessionEvent } from "@earendil-works/pi-coding-agent";
export type RuntimeEvent = PiAgentSessionEvent | { type: string; [key: string]: unknown };

// ─── Pichamber-specific types ──────────────────────────────────────────────
// SessionInfo: matches what pichamber's server sends (createdAt/modifiedAt are
// epoch seconds, not Pi's created/modified Date objects).
export interface SessionInfo {
  id: string;
  name?: string;
  path: string;
  cwd: string;
  parentSessionPath?: string;
  createdAt: number;
  modifiedAt: number;
  messageCount: number;
  firstMessage: string;
}

// Pichamber UI types (no Pi equivalent)
export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface SessionTab {
  id: string;
  projectId: string;
  title: string;
  sessionPath?: string;
  running: boolean;
  unread: boolean;
}

export interface PiSessionGroup {
  cwd: string;
  name: string;
  available: boolean;
  sessions: SessionInfo[];
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  children?: TreeEntry[];
}

export interface OpenFile {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

// Live tool state — Pi emits tool_execution_* as separate events that don't
// belong to a specific message. We track them here so the UI can show
// progress + partial results while a tool is running.
export interface RunningTool {
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  startedAt: number;
  endedAt?: number;
}
