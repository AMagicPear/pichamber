import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSessionEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionEntry,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";

export type {
  AgentMessage,
  AgentSessionEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
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

/** 一条统一的消息条目：回复、工具执行都按实际发生顺序排在同一个列表里。
 *  id 由服务器铸造并终生不变（user/assistant 为 u-N/a-N，工具为 pi 的
 *  toolCallId），流式/运行中为 live 阶段，落定后翻转为 committed ——
 *  客户端按 id 原地更新即可，不需要任何搬运/去重逻辑。 */
export type LiveItem =
  | {
      id: string;
      kind: "user";
      phase: "live" | "committed";
      message: AgentMessage;
    }
  | {
      id: string;
      kind: "assistant";
      phase: "live" | "committed";
      message: AgentMessage;
    }
  | {
      id: string;
      kind: "tool";
      phase: "live" | "committed";
      /** 执行信息（参数/进度/结果），提交后仍保留以支撑标签渲染。 */
      tool: LiveToolExecution;
      /** 权威的 toolResult 消息，提交（message_end）后填充。 */
      message?: AgentMessage;
    }
  | {
      id: string;
      kind: "custom";
      phase: "live" | "committed";
      message: AgentMessage;
      /** pi 会话条目 id；重建时按它匹配以保持 id 稳定（custom 消息重建
       *  时会新建对象，无法像普通消息那样按对象身份匹配）。 */
      entryId?: string;
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

/** JSON messages the server sends to session WebSocket clients.
 *  每个消息都携带单调递增的 seq；客户端发现 seq 不连续即请求 resync。 */
export type ServerMessage =
  | {
      type: "snapshot";
      seq: number;
      busy: boolean;
      items: LiveItem[];
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
    }
  | { type: "item"; seq: number; item: LiveItem }
  | {
      type: "state";
      seq: number;
      busy?: boolean;
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
    }
  /** 扩展 UI 请求（官方 RPC 模式 extension_ui_request 帧原样转发）。 */
  | { type: "ui_request"; request: RpcExtensionUIRequest }
  | { type: "error"; error: string };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage =
  | { type: "prompt"; message: string }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "resync" }
  /** 扩展 UI 应答（官方 RPC 模式 extension_ui_response 帧原样转发）。 */
  | { type: "ui_response"; response: RpcExtensionUIResponse };

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
