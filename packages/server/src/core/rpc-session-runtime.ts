/**
 * RPC-backed session runtime.
 *
 * Spawns a user-installed `pi --mode rpc` subprocess and proxies the
 * session surface through Pi's JSONL protocol
 * (https://github.com/earendil-works/pi-coding-agent/blob/main/docs/rpc.md).
 *
 * The default SDK runtime drives Pi in-process; this runtime is the
 * "optional compatibility and process-isolation mode" from
 * `docs/architecture.md`. It must negotiate the Pi version and the
 * commands we depend on (subscribe → events, prompt/steer/follow_up/
 * abort/compact/set_model/set_thinking_level/get_state/entries/etc.)
 * before letting a session open. When a command isn't available the
 * `start()` step throws, so callers see an explicit failure rather than
 * silent degradation.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { existsSync } from "node:fs";
import {
  type AgentSessionEvent,
  type ExtensionUIContext,
  type JsonAgentSessionEvent,
  type RpcExtensionUIRequest,
  type RpcExtensionUIResponse,
  type SessionEntry,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  type RuntimeClearedQueue,
  type RuntimeModelDescriptor,
  type RuntimeModelInfo,
  type RuntimePromptOptions,
  type RuntimeResources,
  type SessionRuntime,
  guiBuiltinSlashCommands,
} from "./runtime";
import { resolveExternalPi } from "../settings/server-settings";
import { SessionManager as SessionManagerCtor } from "@earendil-works/pi-coding-agent";
import { RpcMessageStream } from "./rpc-message-stream";

type RpcPayload = Record<string, unknown> & { type: string };

type RpcResponseOk = {
  type: "response";
  id?: string;
  command: string;
  success: true;
  data?: unknown;
};
type RpcResponseErr = {
  type: "response";
  id?: string;
  command: string;
  success: false;
  error: string;
};
type RpcResponse = RpcResponseOk | RpcResponseErr;

/** Read one credential from the same external Pi installation that owns the
 * RPC session. The value stays inside the server process and is never logged
 * or exposed over the browser protocol. */
const printExternalProviderApiKey = async (
  command: string,
  cwd: string,
  providerId: string,
): Promise<string | undefined> => {
  const child = Bun.spawn([command, "auth", "print-api-key", "--provider", providerId], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "ignore",
  });
  const timeout = setTimeout(() => child.kill(), 10_000);
  const exitCode = await child.exited;
  clearTimeout(timeout);
  if (exitCode !== 0) return undefined;
  const apiKey = (await new Response(child.stdout).text()).trim();
  return apiKey || undefined;
};

/** Minimum JSONL client: start, send, on event, stop. Mirrors the
 *  shape of `@earendil-works/pi-coding-agent`'s `RpcClient` but spawns
 *  a user-provided binary instead of the bundled SDK.
 *
 * Extension UI events (`extension_ui_request`) come through the same
 * stdout stream as session events but have a different shape, so
 * they're dispatched via a separate listener set (`uiListeners`).
 * The bridge writes responses straight to stdin — the subprocess
 * resolves its own pending dialogs, so no local tracking is needed. */
class RpcProcessClient {
  private process: ChildProcess | null = null;
  private nextId = 0;
  private pending = new Map<
    string,
    { resolve: (value: RpcResponse) => void; reject: (reason: Error) => void }
  >();
  private eventListeners = new Set<(event: AgentSessionEvent) => void>();
  private messageStream = new RpcMessageStream();
  private uiListeners = new Set<(request: RpcExtensionUIRequest) => void>();
  /** UI requests emitted before any listener subscribed (the subprocess
   *  emits status/widget calls during `bindExtensions`, which runs in
   *  its own startup — before our WS layer attaches). Held until the
   *  first listener shows up, then drained in order. */
  private pendingUiRequests: RpcExtensionUIRequest[] = [];
  private stderrBuf = "";
  private exitError: Error | null = null;
  private stopped = false;

  constructor(
    private readonly command: string,
    private readonly cwd: string,
    private readonly extraArgs: string[] = [],
  ) {}

  async start(): Promise<void> {
    if (this.process) throw new Error("RPC client already started");
    const child = spawn(this.command, ["--mode", "rpc", ...this.extraArgs], {
      cwd: this.cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrBuf += chunk;
    });

    child.on("exit", (code, signal) => {
      const error = new Error(
        `External pi exited (code=${code ?? "null"} signal=${signal ?? "null"}). Stderr: ${this.stderrBuf}`,
      );
      this.exitError = error;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.process = null;
    });

    child.on("error", (error) => {
      this.exitError = error;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.process = null;
    });

    // Strict LF-only JSONL reader (Node's readline splits on U+2028 /
    // U+2029 which is illegal inside JSON strings).
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    const stdout = child.stdout;
    if (!stdout) throw new Error("External pi has no stdout");
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      buffer += chunk;
      while (true) {
        const i = buffer.indexOf("\n");
        if (i === -1) return;
        const line = buffer.slice(0, i).endsWith("\r")
          ? buffer.slice(0, i - 1)
          : buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.length) this.handleLine(line);
      }
    });
    stdout.on("end", () => {
      const tail = decoder.end();
      if (tail) this.handleLine(tail);
    });

    // Quick sanity ping: `get_state` should respond promptly if the
    // subprocess is healthy. This also lets us surface early stderr as
    // an error rather than a hung client.
    await this.send({ type: "get_state" }, 5_000);
  }

  async stop(): Promise<void> {
    if (this.stopped || !this.process) return;
    this.stopped = true;
    const child = this.process;
    try {
      child.stdin?.end();
    } catch {
      // ignore: stdin may already be closed when the peer crashed
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.process = null;
    for (const pending of this.pending.values())
      pending.reject(new Error("RPC client stopped"));
    this.pending.clear();
  }

  onEvent(listener: (event: AgentSessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /** Subscribe to extension UI requests emitted by the subprocess. The
   *  subprocess's own extension runner writes `extension_ui_request`
   *  JSON lines on stdout when an extension calls any `ctx.ui.*` method;
   *  the matching `extension_ui_response` must be written back on stdin
   *  for dialog methods to resolve.
   *
   *  Any requests buffered before the first listener attaches are
   *  drained synchronously into the new listener, so the early
   *  `setStatus` calls from extensions like `goal` / `telegram-bridge`
   *  still reach the browser even when they fire during the
   *  subprocess's startup, before our WS channel is attached. */
  onExtensionUiRequest(listener: (request: RpcExtensionUIRequest) => void): () => void {
    this.uiListeners.add(listener);
    if (this.pendingUiRequests.length > 0) {
      const drained = this.pendingUiRequests;
      this.pendingUiRequests = [];
      for (const request of drained) listener(request);
    }
    return () => {
      this.uiListeners.delete(listener);
    };
  }

  /** Write a single `extension_ui_response` frame to the subprocess's
   *  stdin. The subprocess's UI context resolves its pending dialog
   *  with the matching id. No-op if the subprocess has gone away. */
  sendExtensionUiResponse(response: RpcExtensionUIResponse): void {
    if (!this.process?.stdin || this.process.stdin.destroyed || !this.process.stdin.writable) return;
    try {
      this.process.stdin.write(JSON.stringify(response) + "\n");
    } catch (error) {
      console.error("Failed to write extension UI response:", error);
    }
  }

  getStderr(): string {
    return this.stderrBuf;
  }

  send(command: Omit<RpcPayload, "id">, timeoutMs = 30_000): Promise<RpcResponse> {
    if (!this.process?.stdin || this.process.stdin.destroyed || !this.process.stdin.writable) {
      const error =
        this.exitError ?? new Error("External pi is not running (stdin closed)");
      return Promise.reject(error);
    }
    const id = `req_${++this.nextId}`;
    const payload = JSON.stringify({ ...command, id }) + "\n";
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${command.type}. Stderr: ${this.stderrBuf}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.process!.stdin!.write(payload);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Ignore non-JSON noise — the external pi should only emit JSONL,
      // but a stray stderr newline shouldn't kill us.
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const data = parsed as RpcPayload;

    // Response for a pending command.
    if (data.type === "response" && typeof data.id === "string" && this.pending.has(data.id)) {
      const pending = this.pending.get(data.id)!;
      this.pending.delete(data.id);
      pending.resolve(data as RpcResponse);
      return;
    }

    // Extension UI requests are dispatched to UI listeners separately.
    // The subprocess tracks its own pending dialogs, so we only need to
    // forward the request out and route responses back via stdin.
    //
    // Subprocess emits these during its own startup (bindExtensions
    // runs before our WS layer attaches), so we buffer any frames
    // that arrive before a listener exists and drain them on first
    // subscription.
    if (data.type === "extension_ui_request") {
      const request = data as RpcExtensionUIRequest;
      if (this.uiListeners.size === 0) {
        this.pendingUiRequests.push(request);
      } else {
        for (const listener of this.uiListeners) listener(request);
      }
      return;
    }

    // RPC message_update frames are delta-only. Restore the cumulative
    // AgentSessionEvent shape promised by SessionRuntime before forwarding.
    const event = this.messageStream.normalize(data as JsonAgentSessionEvent);
    if (!event) return;
    for (const listener of this.eventListeners) listener(event);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────

export const createRpcSessionRuntime = async ({
  cwd,
  sessionFile,
}: {
  cwd: string;
  sessionFile?: string;
}): Promise<SessionRuntime> => {
  const externalPi = resolveExternalPi();
  if (!externalPi) {
    throw new Error(
      "External pi is enabled but no executable was found. Configure the path in Settings → Behavior.",
    );
  }
  if (!existsSync(externalPi)) {
    throw new Error(`External pi not found at: ${externalPi}`);
  }

  const client = new RpcProcessClient(externalPi, cwd);
  await client.start();

  // Probe the subprocess with one no-arg command before we start using
  // it. If the external pi doesn't speak JSON RPC at all (very old
  // version, wrong binary, …) it will hang or close stdin; either way
  // the WS layer will surface the failure on first use. We use
  // `get_state` because it's the cheapest call and is the canonical
  // way to verify a freshly-spawned RPC subprocess is healthy.
  try {
    const response = await client.send({ type: "get_state" });
    if (!response.success) throw new Error(`External pi rejected get_state: ${response.error}`);
  } catch (error) {
    await client.stop();
    throw error instanceof Error
      ? error
      : new Error(`External pi failed probe: ${String(error)}`);
  }

  // Pick the session: open existing file or start fresh.
  if (sessionFile) {
    const response = await client.send({ type: "switch_session", sessionPath: sessionFile });
    if (!response.success) {
      await client.stop();
      throw new Error(`External pi failed to switch to ${sessionFile}: ${response.error}`);
    }
  } else {
    const response = await client.send({ type: "new_session" });
    if (!response.success) {
      await client.stop();
      throw new Error(`External pi failed to start a new session: ${response.error}`);
    }
  }

  const state0 = (await client.send({ type: "get_state" })) as RpcResponseOk;
  if (!state0.success || !state0.data) {
    await client.stop();
    throw new Error("External pi returned no state after open");
  }
  type RpcState = {
    model?: { provider: string; id: string; name?: string; reasoning?: boolean; contextWindow?: number };
    thinkingLevel: ThinkingLevel;
    isStreaming: boolean;
    isCompacting: boolean;
    sessionFile?: string;
    sessionId: string;
    sessionName?: string;
    steeringMode: "all" | "one-at-a-time";
    followUpMode: "all" | "one-at-a-time";
    autoCompactionEnabled: boolean;
    messageCount: number;
    pendingMessageCount: number;
  };
  const initialState = state0.data as RpcState;
  const sessionId = initialState.sessionId;
  if (!sessionId) {
    await client.stop();
    throw new Error("External pi returned no sessionId");
  }

  // ── Live state mirrors of the subprocess ──────────────────────────
  // We mirror only what the runtime interface exposes. Anything else
  // (events, messages) flows through `subscribe`.
  let model = initialState.model;
  let thinkingLevel = initialState.thinkingLevel;
  let isStreaming = initialState.isStreaming;
  let isCompacting = initialState.isCompacting;
  let pendingSteering: string[] = [];
  let pendingFollowUp: string[] = [];

  const unsub = client.onEvent((event) => {
    switch (event.type) {
      case "agent_start":
        isStreaming = true;
        break;
      case "agent_settled":
        isStreaming = false;
        break;
      case "compaction_start":
        isCompacting = true;
        break;
      case "compaction_end":
        isCompacting = false;
        break;
      case "queue_update":
        pendingSteering = [...event.steering];
        pendingFollowUp = [...event.followUp];
        break;
      case "thinking_level_changed":
        thinkingLevel = event.level;
        break;
    }
  });

  // After open, fetch the canonical model + tools state. The session
  // file path comes from `get_state` so we don't have to track it
  // separately.
  const resolvedSessionFile = initialState.sessionFile;

  const send = async (
    command: Omit<RpcPayload, "id">,
    timeoutMs?: number,
  ): Promise<RpcResponseOk["data"]> => {
    const response = await client.send(command, timeoutMs);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  };

  // Fetch the model's available thinking levels up front so the WS
  // layer can include them in state broadcasts without an extra hop.
  let cachedThinkingLevels: ThinkingLevel[] = ["off"];
  try {
    const lvls = (await send({ type: "get_available_thinking_levels" })) as
      | { levels?: ThinkingLevel[] }
      | undefined;
    if (lvls?.levels?.length) cachedThinkingLevels = lvls.levels;
  } catch {
    /* fall back to ["off"] */
  }

  // Refresh current model from get_state; this also catches the
  // set_model response payload so we don't get out of sync after a switch.
  const refreshModelFromState = async () => {
    const data = (await send({ type: "get_state" })) as RpcState | undefined;
    if (data?.model) model = data.model;
    if (data?.thinkingLevel) thinkingLevel = data.thinkingLevel;
    const levels = (await send({ type: "get_available_thinking_levels" })) as
      | { levels?: ThinkingLevel[] }
      | undefined;
    cachedThinkingLevels = levels?.levels?.length ? levels.levels : [thinkingLevel];
  };

  const runtime: SessionRuntime = {
    type: "rpc",

    get sessionId() {
      return sessionId;
    },
    get cwd() {
      return cwd;
    },
    get sessionFile() {
      return resolvedSessionFile;
    },
    get isStreaming() {
      return isStreaming;
    },
    get isCompacting() {
      return isCompacting;
    },
    get supportsQueueRestore() {
      return false;
    },
    get thinkingLevel(): ThinkingLevel {
      return thinkingLevel;
    },

    async dispose() {
      unsub();
      await client.stop();
    },

    subscribe(listener: (event: AgentSessionEvent) => void) {
      return client.onEvent(listener);
    },

    async prompt(message: string, options?: RuntimePromptOptions) {
      await send({
        type: "prompt",
        message,
        images: options?.images,
        streamingBehavior: options?.streamingBehavior,
      });
    },
    async steer(message: string) {
      await send({ type: "steer", message });
    },
    async followUp(message: string) {
      await send({ type: "follow_up", message });
    },
    async abort() {
      await send({ type: "abort" });
    },
    async compact(customInstructions?: string) {
      return send({ type: "compact", customInstructions });
    },
    async reload() {
      // RPC mode talks to an external `pi --mode rpc` over JSONL, which
      // doesn't yet expose a reload command. Until Pi adds one, surface
      // the gap explicitly so callers can decide to fall back to the
      // SDK backend or just re-spawn the process.
      throw new Error("/reload is not supported by the RPC runtime");
    },
    async setModel(provider: string, modelId: string) {
      await send({ type: "set_model", provider, modelId });
      await refreshModelFromState();
    },
    async setThinkingLevel(level: ThinkingLevel) {
      await send({ type: "set_thinking_level", level });
      thinkingLevel = level;
    },
    clearQueue(): RuntimeClearedQueue {
      const steering = pendingSteering;
      const followUp = pendingFollowUp;
      pendingSteering = [];
      pendingFollowUp = [];
      // The public RPC protocol cannot clear its remote queue without
      // aborting. `restore_pending` is disabled for this runtime, and the
      // WebSocket abort path performs exactly one explicit abort afterwards.
      return { steering, followUp };
    },

    async getAvailableModels(): Promise<RuntimeModelInfo[]> {
      const data = (await send({ type: "get_available_models" })) as
        | { models?: RuntimeModelInfo[] }
        | undefined;
      return data?.models ?? [];
    },
    getAvailableThinkingLevels(): ThinkingLevel[] {
      // RPC mode caches the levels at session open and refreshes them
      // when the user switches models. The runtime interface exposes
      // this synchronously so the WS layer can include it in state
      // broadcasts without an extra round-trip.
      return cachedThinkingLevels;
    },
    getActiveToolNames(): string[] {
      // RPC doesn't expose the active-tool list; the SDK can fall back
      // to "" because the Extensions settings pane only needs names for
      // its display, not for dispatching.
      return [];
    },

    // Provider metadata isn't available over RPC. Fall back to the id
    // so the UI still has a label; quota adapters will simply see
    // `undefined` and skip themselves.
    getProviderName(providerId: string): string {
      return providerId;
    },
    getProviderBaseUrl(): string | undefined {
      return undefined;
    },
    getProviderApiType(): string | undefined {
      return undefined;
    },
    getProviderApiKey(providerId: string): Promise<string | undefined> {
      return printExternalProviderApiKey(externalPi, cwd, providerId);
    },
    getCurrentModel(): RuntimeModelDescriptor | undefined {
      if (!model) return undefined;
      return {
        provider: model.provider,
        providerName: model.provider,
        id: model.id,
        name: model.name ?? model.id,
        reasoning: Boolean(model.reasoning),
        contextWindow: model.contextWindow ?? 0,
      };
    },

    async getResources(): Promise<RuntimeResources> {
      // RPC exposes slash commands but not the extension/tool inventory.
      const payload = (await send({ type: "get_commands" })) as
        | { commands?: RuntimeResources["commands"] }
        | undefined;
      // Prepend the same GUI builtins the SDK path surfaces, so RPC
      // backends present an identical shelf regardless of which runtime
      // backs the session.
      return {
        commands: [...guiBuiltinSlashCommands(), ...(payload?.commands ?? [])],
        tools: [],
        extensions: [],
        diagnostics: [],
        extensionInventoryAvailable: false,
      };
    },

    async buildConversationEntries(): Promise<SessionEntry[]> {
      const data = (await send({ type: "get_entries" })) as
        | { entries?: unknown[] }
        | undefined;
      // The JSONL protocol emits SessionEntry records as plain JSON.
      // Their on-the-wire schema is a structural superset of the
      // in-memory SessionEntry shape, so we trust the cast.
      return (data?.entries ?? []) as SessionEntry[];
    },

    async getSessionStats() {
      return (await send({ type: "get_session_stats" })) as never;
    },

    async getSessionInfo(): Promise<SessionInfo | null> {
      // The subprocess only knows the current session. Reuse the
      // SessionManager on the server for full listings (it lives in
      // `~/.pi/agent/sessions` so the SDK and the external pi share a
      // directory).
      if (!resolvedSessionFile) return null;
      try {
        const manager = SessionManagerCtor.open(resolvedSessionFile);
        return {
          id: sessionId,
          path: resolvedSessionFile,
          cwd: manager.getCwd(),
          name: initialState.sessionName,
          created: new Date(0),
          modified: new Date(),
          messageCount: initialState.messageCount,
          firstMessage: "",
          allMessagesText: "",
        };
      } catch {
        return null;
      }
    },

    async bindExtensions(_uiContext: ExtensionUIContext) {
      // The subprocess runs extensions in its own process with its own
      // UI context. The WS layer wires up the cross-process bridge via
      // `subscribeExtensionUiRequests` / `sendExtensionUiResponse`
      // (see below), so this no-op is correct.
    },

    /** Bridge extension UI requests from the subprocess to the host.
     *  Called by the WS layer after `bindExtensions` to forward each
     *  `ctx.ui.*` invocation to the browser via `ui_request`. */
    subscribeExtensionUiRequests(listener: (request: RpcExtensionUIRequest) => void): () => void {
      return client.onExtensionUiRequest(listener);
    },

    /** Write a single `extension_ui_response` to the subprocess's
     *  stdin. The subprocess's UI context resolves its own pending
     *  dialog. */
    sendExtensionUiResponse(response: RpcExtensionUIResponse): void {
      client.sendExtensionUiResponse(response);
    },
  };

  return runtime;
};
