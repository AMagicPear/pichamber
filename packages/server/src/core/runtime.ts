/**
 * Session runtime abstraction.
 *
 * The web layer talks to a per-session runtime over a single `subscribe`
 * stream plus a small set of imperative methods (prompt/abort/compact/…).
 * Two implementations live behind this interface:
 *
 *   • `SdkSessionRuntime` (default) — drives Pi's bundled `AgentSession`
 *     in-process. Reuses everything in `core/`.
 *   • `RpcSessionRuntime` — spawns a user-installed `pi --mode rpc` and
 *     proxies the same surface through Pi's JSONL protocol
 *     (https://github.com/earendil-works/pi-coding-agent/blob/main/docs/rpc.md).
 *
 * The runtime covers only agent concerns (prompts, events, model,
 * thinking level, session state, extension UI). Files, Git, and PTY are
 * server services and never reach into the runtime — that boundary is
 * what lets both backends coexist behind one WebSocket protocol.
 */
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionUIContext,
  ModelInfo,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionEntry,
  SessionInfo,
  SessionStats,
  SlashCommandInfo,
  SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PromptImage } from "@pichamber/shared";

export type { AgentSessionEvent, SourceInfo };

export type SessionRuntimeType = "sdk" | "rpc";

/** Curated subset of Pi's `BUILTIN_SLASH_COMMANDS` that maps cleanly to GUI
 *  concepts. The web client shows them in the slash-command shelf so users
 *  can discover them, but they don't auto-execute: typing `/compact` still
 *  just sends the text, since the SDK session doesn't intercept built-ins
 *  the way the TUI does. That matches the "label, not action" intent of the
 *  shelf — keeping the picker honest about what each entry will do. Skip
 *  TUI-only flows (`/settings`, `/login`, `/hotkeys`, `/quit`, …) and
 *  anything with an existing GUI control (`/model` → ModelSelector,
 *  `/new` → + new session button). */
type BuiltinSlashCommand = Omit<SlashCommandInfo, "source"> & { source: "builtin" };

const guiBuiltinSourceInfo = (name: string): SourceInfo =>
  createSyntheticSourceInfo(`builtin:${name}`, { source: "pi-builtin" });

const GUI_BUILTIN_COMMANDS: readonly BuiltinSlashCommand[] = [
  { name: "compact", description: "Manually compact the session context", source: "builtin", sourceInfo: guiBuiltinSourceInfo("compact") },
  { name: "new", description: "Start a new session", source: "builtin", sourceInfo: guiBuiltinSourceInfo("new") },
  { name: "name", description: "Set session display name", source: "builtin", sourceInfo: guiBuiltinSourceInfo("name") },
  { name: "resume", description: "Resume a different session", source: "builtin", sourceInfo: guiBuiltinSourceInfo("resume") },
  { name: "fork", description: "Create a new fork from a previous user message", source: "builtin", sourceInfo: guiBuiltinSourceInfo("fork") },
  { name: "clone", description: "Duplicate the current session at the current position", source: "builtin", sourceInfo: guiBuiltinSourceInfo("clone") },
  { name: "reload", description: "Reload extensions, prompts, themes, and context files", source: "builtin", sourceInfo: guiBuiltinSourceInfo("reload") },
];

/** `SlashCommandSource` doesn't include "builtin" (Pi keeps that union
 *  for runtime-discovered commands only); cast once here so callers get a
 *  plain `SlashCommandInfo[]` they can spread alongside extension/prompt/
 *  skill commands without further fuss. */
export const guiBuiltinSlashCommands = (): SlashCommandInfo[] =>
  GUI_BUILTIN_COMMANDS as unknown as SlashCommandInfo[];

export type RuntimeToolInfo = {
  name: string;
  description: string;
  sourceInfo: SourceInfo;
  active: boolean;
};

export type RuntimeExtensionInfo = {
  path: string;
  sourceInfo: SourceInfo;
  commands: string[];
  tools: string[];
};

export type RuntimeDiagnostics = Array<{ path: string; error: string }>;

export type RuntimeResources = {
  commands: SlashCommandInfo[];
  tools: RuntimeToolInfo[];
  extensions: RuntimeExtensionInfo[];
  diagnostics: RuntimeDiagnostics;
  extensionInventoryAvailable: boolean;
};

/** Slim descriptor the wire ships. `name` and `providerName` come from
 *  Pi's provider/model registry; we mirror them through the runtime so
 *  the RPC backend can still surface user-friendly labels. */
export type RuntimeModelDescriptor = {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
};

/** Model rows used for selection. Pi's public RPC type omits `name`, but
 * SDK snapshots and newer RPC builds can provide it, so retain it when present. */
export type RuntimeModelInfo = ModelInfo & { name?: string };

export type RuntimePromptOptions = {
  /** When streaming, how to queue the message: "steer" or "followUp". */
  streamingBehavior?: "steer" | "followUp";
  /** Inline image attachments, in the public RPC wire format. */
  images?: PromptImage[];
};

export type RuntimeClearedQueue = {
  steering: string[];
  followUp: string[];
};

/**
 * Single per-session runtime. Both backends construct this once per
 * active session and dispose it when the last client drops (see
 * `session.ts:deactivateSession`). All implementations must emit
 * `agent_settled` whenever the session returns to idle so the WS layer
 * can flush queued messages and refresh stats.
 */
export interface SessionRuntime {
  readonly type: SessionRuntimeType;
  readonly sessionId: string;
  /** Effective working directory of the session. */
  readonly cwd: string;
  /** Persisted session file, when available. */
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  /** Whether queued messages can be removed without interrupting a live run. */
  readonly supportsQueueRestore: boolean;
  /** Current thinking level. Mirrored from `thinking_level_changed`
   *  events so the WS layer can read it synchronously when broadcasting
   *  state frames. */
  readonly thinkingLevel: ThinkingLevel;

  /** Tear down the runtime. Idempotent. After dispose, no further calls
   *  (including event subscribers) are valid. */
  dispose(): void | Promise<void>;

  /** Subscribe to events. Returns an unsubscribe function. */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;

  // ── Agent actions ────────────────────────────────────────────────

  prompt(message: string, options?: RuntimePromptOptions): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  compact(customInstructions?: string): Promise<unknown>;
  /** Reload extensions, prompts, themes, context files, and providers —
   *  mirrors the TUI's `/reload`. SDK calls `session.reload()`; RPC
   *  throws because reloading an external `pi --mode rpc` process isn't
   *  part of the JSONL protocol yet. Add a `reload` RPC command upstream
   *  when that need arises; for now the surface is SDK-only. */
  reload(): Promise<void>;
  setModel(provider: string, modelId: string): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  clearQueue(): RuntimeClearedQueue;

  // ── State queries ─────────────────────────────────────────────────

  /** Resolved to a `RuntimeModelInfo` from the SDK or to a row from
   *  `RpcClient.getAvailableModels()` — both share the same wire shape. */
  getAvailableModels(): Promise<RuntimeModelInfo[]>;
  /** Sync wrapper used by the WS layer so a state broadcast can include
   *  the levels without an async hop. Cached at construction and
   *  refreshed on model switches. */
  getAvailableThinkingLevels(): ThinkingLevel[];
  getActiveToolNames(): string[];

  /** `providerName` falls back to `providerId` when the runtime has no
   *  provider registry (RPC mode). `providerApiType` is only used by
   *  quota adapters; RPC mode returns `undefined`. */
  getProviderName(providerId: string): string;
  getProviderBaseUrl(providerId: string): string | undefined;
  getProviderApiType(providerId: string): string | undefined;
  /** Resolve one provider credential from the runtime that owns it. RPC
   * runtimes invoke their external Pi binary, so callers never fall back to
   * credentials from the bundled SDK. */
  getProviderApiKey?(providerId: string): Promise<string | undefined>;

  /** Currently active model. `name` and `providerName` may fall back to
   *  ids if the registry has no friendly label. */
  getCurrentModel(): RuntimeModelDescriptor | undefined;

  // ── Resource snapshots (Settings → Extensions) ──────────────────

  /** Fetch commands/tools/extensions/diagnostics. RPC exposes slash commands
   *  but not an extension inventory, which is marked explicitly in the result. */
  getResources(): Promise<RuntimeResources>;

  // ── Conversation / stats ─────────────────────────────────────────

  /** Ordered session entries on the active branch. SDK uses
   *  `SessionManager.buildContextEntries()`; RPC uses `getEntries()`
   *  and converts the JSONL shape to the in-memory `SessionEntry`. */
  buildConversationEntries(): Promise<SessionEntry[]>;

  /** Cached session stats; SDK uses `getSessionStats()`, RPC uses the
   *  same call through the JSONL protocol. */
  getSessionStats(): Promise<SessionStats>;

  /** Wire-format session info used by `listAllSessions`. The SDK
   *  implementation just forwards the SessionInfo list; RPC returns the
   *  active session (other sessions live in the SDK's `SessionManager`,
   *  so we expose them separately when listing). */
  getSessionInfo(): Promise<SessionInfo | null>;

  // ── Extensions ──────────────────────────────────────────────────

  /** Bind extensions with the given UI context. Mirrors Pi's
   *  `AgentSession.bindExtensions({ uiContext, mode: "rpc" })`. */
  bindExtensions(uiContext: ExtensionUIContext): Promise<void>;

  /** SDK-only escape hatch. Carries the underlying `AgentSession` so
   *  quota, persistence, and tests can reach the model registry without
   *  bloating the public interface. RPC runtimes always leave this
   *  undefined. The caller is expected to narrow on `type === "sdk"`. */
  readonly agentSession?: AgentSession;

  /** RPC-only bridge: subscribe to extension UI requests emitted by
   *  the subprocess. The SDK backend handles this internally via
   *  `bindExtensions`; RPC runtimes need a cross-process bridge
   *  because extensions run in the subprocess and their `ctx.ui.*`
   *  calls surface as `extension_ui_request` JSON lines on stdout. */
  subscribeExtensionUiRequests?(
    listener: (request: RpcExtensionUIRequest) => void,
  ): () => void;

  /** RPC-only bridge: write an `extension_ui_response` back to the
   *  subprocess's stdin. Required so dialog methods can resolve; the
   *  SDK backend doesn't need it because `bindExtensions` handles the
   *  round-trip internally. */
  sendExtensionUiResponse?(response: RpcExtensionUIResponse): void;
}

// ─── Factory ──────────────────────────────────────────────────────────

import { getServerSettings } from "../settings/server-settings";
import { createSdkSessionRuntime } from "./sdk-session-runtime";
import { createRpcSessionRuntime } from "./rpc-session-runtime";

export type CreateRuntimeOptions = {
  cwd: string;
  /** Pre-created session file path when switching to an existing
   *  session; `undefined` to start a brand-new session. */
  sessionFile?: string;
};

/** Decide which backend to use based on the resolved server settings. */
export const pickRuntimeType = (): SessionRuntimeType => {
  const settings = getServerSettings();
  return settings.useExternalPi ? "rpc" : "sdk";
};

export const createSessionRuntime = async (
  options: CreateRuntimeOptions,
): Promise<SessionRuntime> => {
  const type = pickRuntimeType();
  if (type === "rpc") {
    return createRpcSessionRuntime(options);
  }
  return createSdkSessionRuntime(options);
};

/** For tests that need to force a particular backend regardless of
 *  server settings. Production code should always go through
 *  `createSessionRuntime`. */
export const createSessionRuntimeAs = async (
  type: SessionRuntimeType,
  options: CreateRuntimeOptions,
): Promise<SessionRuntime> => {
  if (type === "rpc") return createRpcSessionRuntime(options);
  return createSdkSessionRuntime(options);
};
