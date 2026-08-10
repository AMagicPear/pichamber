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
  /** True while an agent run is in progress (first message_start of the
   *  run … agent_settled). Lets the client distinguish "mid-run lulls"
   *  (e.g. between committing a reply and the next tool event) from the
   *  run actually finishing. */
  busy: boolean;
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

// ─── REST wire types ───────────────────────────────────────────────────

/** Request body for POST /api/pty/start. */
export type PtyStartOptions = {
  /** Working directory for the spawned shell. Defaults to the user's home. */
  cwd?: string;
  cols: number;
  rows: number;
  /** Override the shell binary. Defaults to $SHELL or platform default. */
  shell?: string;
};

/** Response body for POST /api/pty/start. */
export type PtyStartResult = {
  ptyId: string;
  shell: string;
  cwd: string;
  /** Display title (`~`, `~/projects/foo`, or full path). Server computes
   *  this from the cwd so the client never duplicates the `~/` collapsing. */
  title: string;
};

/** One entry in GET /api/fs/list. */
export type DirEntry = {
  name: string;
  path: string;
  /** Path relative to the active workspace root, or "" if outside. */
  relativePath: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
};

/** Response body for GET /api/fs/list. */
export type ListResult = {
  path: string;
  /** Display form of `path` (`~` for the workspace root). */
  displayPath: string;
  entries: DirEntry[];
};

/** Response body for GET /api/version. */
export type VersionInfo = {
  /** The pi coding-agent version the server embeds. */
  pi: string;
};

// ─── Git (Git pane) wire types ────────────────────────────────────────

/** One changed file from `git status --porcelain`. */
export type GitChange = {
  /** Workspace-relative path (renames carry the destination). */
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  /** True when the change is staged (present in the index). */
  staged: boolean;
};

/** Response body for GET /api/git/status. */
export type GitStatus = {
  /** Current branch name, or null on a detached HEAD. */
  branch: string | null;
  changes: GitChange[];
};

/** Response body for GET /api/git/diff. */
export type GitDiffResult = {
  /** Unified diff text; empty for files git can't diff (untracked). */
  diff: string;
};

/** Request body for POST /api/git/stage and /api/git/unstage. */
export type GitStageRequest = {
  /** Session workspace root; omit to use the server default. */
  cwd?: string;
  /** Paths to stage/unstage. Omit for stage to add everything. */
  paths?: string[];
};

/** Request body for POST /api/git/commit. */
export type GitCommitRequest = {
  /** Session workspace root; omit to use the server default. */
  cwd?: string;
  message: string;
};
