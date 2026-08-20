import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSessionEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionEntry,
  SessionInfo,
  SlashCommandInfo,
  SourceInfo,
} from "@earendil-works/pi-coding-agent";

export * from "./paths";

export type {
  AgentMessage,
  AgentSessionEvent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionEntry,
  SessionInfo,
  SlashCommandInfo,
  SourceInfo,
};

export type AgentActivity =
  | { phase: "idle" }
  | { phase: "thinking" }
  | { phase: "responding" }
  | { phase: "tool"; toolName: string }
  | { phase: "compacting" }
  | { phase: "retrying"; attempt: number; maxAttempts: number };

export type PendingMessages = {
  steering: string[];
  followUp: string[];
};

export type RuntimeToolInfo = {
  name: string;
  description: string;
  active: boolean;
  sourceInfo: SourceInfo;
};

export type ExtensionInfo = {
  path: string;
  sourceInfo: SourceInfo;
  commands: string[];
  tools: string[];
};

export type RuntimeResources = {
  commands: SlashCommandInfo[];
  tools: RuntimeToolInfo[];
  extensions: ExtensionInfo[];
  diagnostics: Array<{ path: string; error: string }>;
  /** False when the active runtime cannot enumerate extension/tool resources. */
  extensionInventoryAvailable: boolean;
};

type ToolExecutionStartEvent = Extract<AgentSessionEvent, { type: "tool_execution_start" }>;
type ToolExecutionUpdateEvent = Extract<AgentSessionEvent, { type: "tool_execution_update" }>;
type ToolExecutionEndEvent = Extract<AgentSessionEvent, { type: "tool_execution_end" }>;

export type LiveToolExecution = Pick<ToolExecutionStartEvent, "toolCallId" | "toolName" | "args"> & {
  result?: ToolExecutionUpdateEvent["partialResult"] | ToolExecutionEndEvent["result"];
  isError?: ToolExecutionEndEvent["isError"];
  running: boolean;
  /** 工具开始执行的时刻（ms）。live 条目在 tool_execution_start 写入，
   *  客户端用它校准 timeout 倒计时；历史重建的 committed 条目没有此字段。 */
  startedAt?: number;
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
    }
  | {
      id: string;
      kind: "compaction";
      phase: "committed";
      /** LLM 生成的上下文压缩摘要。 */
      summary: string;
      /** 压缩前的 token 数。 */
      tokensBefore: number;
      timestamp: number;
      /** pi 会话条目 id，语义同 custom.entryId。 */
      entryId?: string;
    };

/** Slim model reference the server emits and accepts on the wire.
 *  We don't ship the full Model<Api> because the pi-ai type erases to
 *  Model<Api> and the wire only cares about provider/id + display info. */
export type ModelDescriptor = {
  /** Pi provider id (e.g. "minimax-cn"). Used for routing/logo lookup. */
  provider: string;
  /** Human-readable provider name from Pi's registry (e.g. "MiniMax"). */
  providerName: string;
  id: string;
  /** Display name; falls back to id when the model registry has no friendly name. */
  name: string;
  /** Whether the model supports extended thinking. */
  reasoning: boolean;
};

/** One slice of a provider's quota — e.g. MiniMax's 5-hour window. */
export type QuotaWindow = {
  /** Short label rendered in the panel ("5h", "Weekly", …). */
  label: string;
  /** Fraction of the window already consumed, in [0, 1]. */
  utilization: number;
  /** Unix ms when this window resets to 0. `0` when the provider has no
   *  reset concept (e.g. DeepSeek's pay-as-you-go balance). */
  resetsAt: number;
  /** Optional free-form override: when a provider's quota isn't really
   *  "utilization of a window" (DeepSeek's balance), the panel shows
   *  this string instead of a progress bar. */
  display?: string;
  /** Amount consumed in this window, when the upstream API reports it. */
  used?: number;
  /** Amount that defines the window limit, when known. */
  limit?: number;
  /** Unit for `used` and `limit` (e.g. "USD", "CNY", "tokens"). */
  unit?: string;
};

/** Successful quota snapshot for a provider. */
export type QuotaSnapshot = {
  provider: string;
  windows: QuotaWindow[];
  /** Unix ms when the server last fetched this from the upstream API. */
  fetchedAt: number;
};

/** Error payload when quota lookup fails (missing key, upstream down,
 *  provider not supported yet, …). Kept in the same shape as a snapshot
 *  minus `windows` so the panel can render a single "not available"
 *  row instead of branching across two record types. */
export type ProviderQuota =
  | (QuotaSnapshot & { error?: undefined })
  | (Omit<QuotaSnapshot, "windows"> & { error: string; windows?: undefined });

/** Provider metadata shared by model and quota surfaces. The display name is
 * resolved from Pi's provider registry on the server; clients must not
 * derive it from ids or adapter labels. */
export type ProviderDescriptor = {
  id: string;
  name: string;
};

/** Credential-safe provider view for the Settings screen. Keys and OAuth
 * tokens never leave the server; this only describes Pi's resolved status. */
export type PiProviderSettings = {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  modelCount: number;
  auth: {
    configured: boolean;
    supportsApiKey: boolean;
    canRemove: boolean;
    source?: string;
    label?: string;
  };
};

/** Runtime behavior settings backed by Pi's SettingsManager setters. */
export type PiBehaviorSettings = {
  autoCompaction: boolean;
  autoRetry: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  transport: "auto" | "sse" | "websocket" | "websocket-cached";
  httpIdleTimeoutMs: number;
};

/** A package or local source configured through Pi's package manager. */
export type PiExtensionSource = {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
  /** Version read from the installed package manifest, when available. */
  version?: string;
};

/** An installed Pi package with a newer registry or remote revision available. */
export type PiExtensionUpdate = {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: "user" | "project";
};

/** One pichamber-shipped built-in extension (e.g. Ark Agent Plan). */
export type PiBuiltinExtension = {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Whether its folder currently exists under `~/.pi/agent/extensions/`. */
  installed: boolean;
};

/** A single extension that the active Pi runtime currently loaded for this session. */
export type LoadedExtensionInfo = {
  /** Server-computed label for the settings UI. */
  label: string;
  /** Absolute path to the extension file or its package directory. */
  path: string;
  /** Origin label: the source string (e.g. `npm:foo`, a git URL, or a local path). */
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  commands: string[];
  tools: string[];
  /** When this loaded entry is one of pichamber's built-ins, its id (e.g. `ark-agent-plan`). */
  builtinId?: string;
};

/** Unified snapshot of all extension state for one session: built-ins pichamber ships, package
 *  sources Pi was told to load, the extensions that ended up loaded, and any load errors. */
export type ExtensionsOverview = {
  builtins: PiBuiltinExtension[];
  sources: PiExtensionSource[];
  loaded: LoadedExtensionInfo[];
  diagnostics: Array<{ path: string; error: string }>;
  /** False when the active runtime cannot enumerate extension inventory (e.g. external RPC). */
  inventoryAvailable: boolean;
};

export type ThinkingState = {
  level: ThinkingLevel;
  /** Levels the current model accepts. The server re-evaluates on model change. */
  availableLevels: ThinkingLevel[];
};

/** Per-message usage breakdown for the most recent assistant turn. Numbers
 *  are the raw token counts the provider reported; the client renders them
 *  via `Intl.NumberFormat`. */
export type LastAssistantUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Pre-computed, ready-to-render session stats. The server builds this from
 *  pi's `AgentSession` so the client doesn't have to duplicate the
 *  formatting (date, percent, cost, cache hit, etc.). Display strings are
 *  already produced; the view also carries the raw values so the client
 *  can re-format if it ever needs to. */
export type SessionStatsView = {
  /** Active model descriptor; mirrors the standalone `state.model` field
   *  but bundled so the Context pane can render without an extra lookup. */
  model: ModelDescriptor | undefined;
  /** Localized "Jul 20, 2026, 9:10 AM" string; empty when no entry has
   *  been recorded yet. */
  modified: string;
  context: {
    /** Estimated context tokens; null when unknown (e.g. right after a
     *  compaction, before the next assistant turn reports usage). */
    tokens: number | null;
    contextWindow: number;
    /** "0.0%"–"100.0%" formatted to one decimal; null while `tokens` is null. */
    percent: string | null;
    /** Comma-grouped token count, e.g. "95,881"; "—" while unknown. */
    tokensText: string;
  };
  messages: {
    total: number;
    user: number;
    assistant: number;
    /** Comma-grouped render of each count, e.g. "1,234". The server owns
     *  the formatting so the client doesn't need a locale-specific
     *  number formatter (project rule: display strings come from the
     *  server). */
    totalText: string;
    userText: string;
    assistantText: string;
  };
  cost: { value: string; raw: number };
  lastAssistant: LastAssistantUsage;
  /** Comma-grouped render of `lastAssistant`, one string per bucket,
   *  for the same reason `messages.*Text` exists. */
  lastAssistantText: { [K in keyof LastAssistantUsage]: string };
  /** Cache hit rate, e.g. "99.4%". `cacheRead / (cacheRead + input)`. */
  cacheHit: string;
};

/** JSON messages the server sends to session WebSocket clients.
 *  每个消息都携带单调递增的 seq；客户端发现 seq 不连续即请求 resync。 */
export type ServerMessage =
  | {
      type: "snapshot";
      seq: number;
      busy: boolean;
      activity: AgentActivity;
      pending: PendingMessages;
      /** Whether pending messages can be removed and restored without
       * interrupting the current agent run. External Pi's public RPC
       * protocol has no equivalent clear-queue command. */
      canRestorePending: boolean;
      items: LiveItem[];
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
      stats?: SessionStatsView;
      resources: RuntimeResources;
    }
  | { type: "item"; seq: number; item: LiveItem }
  | {
      type: "state";
      seq: number;
      busy?: boolean;
      activity?: AgentActivity;
      pending?: PendingMessages;
      model?: ModelDescriptor;
      availableModels?: ModelDescriptor[];
      thinking?: ThinkingState;
      stats?: SessionStatsView;
      resources?: RuntimeResources;
    }
  /** 扩展 UI 请求（官方 RPC 模式 extension_ui_request 帧原样转发）。 */
  | { type: "ui_request"; request: RpcExtensionUIRequest }
  | { type: "draft_restore"; messages: string[] }
  | { type: "error"; error: string };

/** JSON messages the client sends to the session WebSocket server. */
export type ClientMessage =
  | { type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp" }
  | { type: "abort"; restorePending?: boolean }
  | { type: "restore_pending" }
  | { type: "compact"; customInstructions?: string }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "resync" }
  /** 扩展 UI 应答（官方 RPC 模式 extension_ui_response 帧原样转发）。 */
  | { type: "ui_response"; response: RpcExtensionUIResponse };

// ─── REST wire types ───────────────────────────────────────────────────

/** Request body for POST /api/pty/start. */
export type PtyStartOptions = {
  /** Session whose working directory owns this terminal. */
  sessionId?: string;
  cols: number;
  rows: number;
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

/** Response body for GET /api/fs/search. */
export type SearchResult = {
  entries: DirEntry[];
};

export type ProjectBrowseResult = {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
};

/** Response body for GET /api/version. */
export type VersionInfo = {
  /** The pi coding-agent version the server embeds. */
  pi: string;
};

/** Server-wide runtime settings (persisted on disk by the server).
 *  Currently only carries the optional external `pi` executable path;
 *  new fields land here when the server needs to remember a choice that
 *  outlives the client process. */
export type ServerSettings = {
  /** When true, new sessions are launched by spawning an external
   *  `pi --mode rpc` subprocess instead of using the bundled SDK.
   *  Toggling this only affects sessions opened after the change —
   *  existing sessions keep their original runtime. */
  useExternalPi: boolean;
  /** Path to the external `pi` binary. Absolute or `$PATH`-resolvable.
   *  Empty means "use whatever `pi` resolves to on $PATH". */
  externalPiPath: string;
  /** Diagnostic snapshot of the external `pi` resolver. Returned by
   *  GET/PUT `/api/settings/server` so the Settings UI can show the
   *  absolute path the server will actually spawn (and surface a clear
   *  hint when the binary isn't on PATH). */
  externalPi: {
    /** Echo of the toggle, redundant with `useExternalPi` for clarity. */
    configured: boolean;
    /** The path string the user typed (after trimming). Empty when
     *  the field was left blank. */
    rawPath: string;
    /** Absolute path to the resolved binary, or `null` when no match
     *  was found. The Settings UI mirrors this in the placeholder. */
    resolved: string | null;
  };
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
  sessionId?: string;
  /** Paths to stage/unstage. Omit for stage to add everything. */
  paths?: string[];
};

/** Request body for POST /api/git/commit. */
export type GitCommitRequest = {
  sessionId?: string;
  message: string;
};

/** One branch entry from `git for-each-ref`. */
export type GitBranch = {
  /** Short branch name (e.g. `main`, `origin/main`). */
  name: string;
  /** Whether this is the currently checked-out branch. Exactly one entry
   *  in the list — or none on detached HEAD — has `current: true`. */
  current: boolean;
  /** Upstream short name (e.g. `origin/main`), or `null` when no
   *  upstream is configured. */
  upstream: string | null;
  /** Raw `git for-each-ref` upstream track string: "" (no upstream),
   *  "ahead N", "behind N", "ahead N, behind M". Kept verbatim so the
   *  client renders the same display git would. */
  track: string;
  /** Short committer date (`YYYY-MM-DD`), last commit that touched the
   *  branch. Empty string for unborn branches. */
  date: string;
  /** True when the ref came from `refs/remotes/*` — a remote-tracking
   *  ref, not a local branch. */
  remote: boolean;
};

/** Response body for GET /api/git/branches. */
export type GitBranchList = {
  /** Name of the active branch (matches `GitBranch.current === true`),
   *  or `null` on detached HEAD. */
  current: string | null;
  branches: GitBranch[];
};

/** One entry from `git stash list`. */
export type GitStash = {
  /** Zero-based position. `stash@{0}` is the most recent. */
  index: number;
  /** Full ref, e.g. `stash@{0}`. */
  ref: string;
  /** Stash subject line (the message given to `git stash push`, or
   *  git's auto-generated `WIP on …` form). */
  message: string;
};

/** Response body for GET /api/git/stashes. */
export type GitStashList = {
  stashes: GitStash[];
};

/** Request body for POST /api/git/checkout and /api/git/stash/drop. */
export type GitCheckoutRequest = {
  sessionId?: string;
  branch: string;
};

export type GitStashPushRequest = {
  sessionId?: string;
  /** Optional human-readable label; git uses `WIP on <branch>: …` when
   *  omitted. */
  message?: string;
  /** Include untracked files (`git stash -u`). Defaults to true — the
   *  common "stash everything" workflow is one click. */
  includeUntracked?: boolean;
};

export type GitStashRefRequest = {
  sessionId?: string;
  /** Stash index (0 = most recent). */
  index: number;
};

export type GitSessionRequest = {
  sessionId?: string;
};
