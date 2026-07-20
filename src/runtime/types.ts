// ─────────────────────────────────────────────────────────────────────────────
// All types in this file are either copied verbatim from Pi's source or are
// pichamber-specific UI types (sidebar, file viewer). The copied types must
// stay in sync with the Pi source paths referenced in each section comment.
// Reference: /Users/amagicpear/projects/pichamber-plans/pi/
// ─────────────────────────────────────────────────────────────────────────────

// ─── Copied from pi/packages/ai/src/types.ts ────────────────────────────────
// Source: pi/packages/ai/src/types.ts (L77-79, L327-345, L383-435, L458-473,
// L706-721). Keep in sync.

export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelThinkingLevel = "off" | ThinkingLevel;
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;

export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: string;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: unknown;
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
export type AgentMessage = Message;

export type AssistantMessageEvent =
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// Model type — keep field shape compatible with Pi; for the UI we only need
// the user-facing fields, but the full shape is used by `get_available_models`.
export interface Model {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

// ─── Copied from pi/packages/ai/src/models.ts ───────────────────────────────
// Source: pi/packages/ai/src/models.ts (L660-694). The EXTENDED list and
// getSupportedThinkingLevels logic must match exactly.

export const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off", "minimal", "low", "medium", "high", "xhigh", "max",
];

export function getSupportedThinkingLevels(model: Model): ModelThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export function clampThinkingLevel(model: Model, level: ModelThinkingLevel): ModelThinkingLevel {
  const available = getSupportedThinkingLevels(model);
  if (available.includes(level)) return level;
  const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
  if (requestedIndex === -1) return available[0] ?? "off";
  for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (available.includes(candidate)) return candidate;
  }
  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (available.includes(candidate)) return candidate;
  }
  return available[0] ?? "off";
}

// ─── Copied from pi/packages/coding-agent/src/core/agent-session.ts ─────────
// Source: pi/packages/coding-agent/src/core/agent-session.ts (L136-163) +
// pi/packages/agent/src/types.ts (L415-430). The shape of every event pichamber
// receives over RPC must match this exactly — `pi --mode rpc` re-emits these
// objects verbatim on stdout.

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

export type AgentSessionEvent =
  | AgentEvent
  | { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
  | { type: "agent_settled" }
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | { type: "compaction_end"; reason: "manual" | "threshold" | "overflow"; result?: unknown; aborted: boolean; willRetry: boolean; errorMessage?: string }
  | { type: "entry_appended"; entry: unknown }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: ThinkingLevel }
  | { type: "model_select"; model: Model }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | { type: "extension_error"; extensionPath: string; event: string; error: string }
  | { type: "error"; error: string };

export type RuntimeEvent = AgentSessionEvent | { type: string; [key: string]: unknown };

// ─── Copied from pi/packages/coding-agent/src/modes/rpc/rpc-types.ts ────────
// Source: pi/packages/coding-agent/src/modes/rpc/rpc-types.ts (L113-126,
// L161-179). pichamber re-emits these as `extension_ui_request` events and
// receives the `UiRequest`-shaped payload inline.

export interface RpcSessionState {
  model?: Model;
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
}

export type RpcExtensionUIRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
  | { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText: string | undefined }
  | { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines: string[] | undefined; widgetPlacement?: "aboveEditor" | "belowEditor" }
  | { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
  | { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

// ─── Copied from pi/packages/coding-agent/src/core/session-manager.ts ───────
// Source: pi/packages/coding-agent/src/core/session-manager.ts (L170-180).
// Used by the sidebar. Stats fields (tokens, cost) are NOT included here —
// they live in `get_session_stats` (rpc-types.ts) and are fetched on demand.

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

// ─── Pichamber UI types (no Pi equivalent) ─────────────────────────────────
// These describe the sidebar / file viewer / shell that wraps the Pi runtime.

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

// Live tool state — Pi emits `tool_execution_*` as separate events that don't
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
