import { isTauri, native } from "./tauri";
import type { ModelInfo, RuntimeEvent } from "./types";

type EventListener = (event: RuntimeEvent) => void;

interface ClientContext {
  cwd: string;
  piPath?: string;
}

export class RpcClient {
  readonly instanceId: string;
  private generation = 0;
  private requestSequence = 0;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
  private listeners = new Set<EventListener>();
  private unlisten: Array<() => void> = [];
  private demoTimers: number[] = [];
  private context?: ClientContext;
  private startInFlight: Promise<void> | null = null;
  connected = false;
  private stderrTail = "";

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  onEvent(listener: EventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RuntimeEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  async start(cwd: string, piPath?: string) {
    this.context = { cwd, piPath: piPath?.trim() ? piPath : undefined };
    if (!isTauri()) {
      await this.stop();
      this.generation += 1;
      this.connected = true;
      this.emit({ type: "rpc_connected", discovery: "browser-demo" });
      return;
    }
    if (!this.startInFlight) this.startInFlight = this.startInternal(this.context).finally(() => { this.startInFlight = null; });
    return this.startInFlight;
  }

  private async startInternal(context: ClientContext) {
    await this.teardownListeners();
    const unlisten = await native.listenRpc(
      (payload) => {
        if (payload.instanceId !== this.instanceId || payload.generation !== this.generation) return;
        try {
          this.handle(JSON.parse(payload.line) as RuntimeEvent);
        } catch {
          this.emit({ type: "error", error: "Pi returned malformed JSON", raw: payload.line });
        }
      },
      (payload) => {
        if (payload.instanceId !== this.instanceId || payload.generation !== this.generation) return;
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) this.emit({ type: "rpc_disconnected", code: payload.code });
      },
      (payload) => {
        if (payload.instanceId === this.instanceId && payload.generation === this.generation) {
          this.stderrTail = `${this.stderrTail}${payload.line}\n`.slice(-2048);
          this.emit({ type: "runtime_stderr", line: payload.line });
        }
      },
    );
    this.unlisten = unlisten;
    try {
      const result = await native.startRpc({ cwd: context.cwd, piPath: context.piPath }, this.instanceId);
      this.generation = result.generation;
      this.connected = true;
      this.emit({ type: "rpc_connected", discovery: result.executable });
    } catch (error) {
      this.teardownListeners();
      const detail = error instanceof Error ? error.message : String(error);
      this.emit({ type: "rpc_disconnected", code: undefined, error: detail });
      throw error;
    }
  }

  private async teardownListeners() {
    const previous = this.unlisten;
    this.unlisten = [];
    previous.forEach((fn) => fn());
  }

  private handle(event: RuntimeEvent) {
    if (event.type === "response" && typeof event.id === "string") {
      const pending = this.pending.get(event.id);
      if (pending) {
        window.clearTimeout(pending.timer);
        this.pending.delete(event.id);
        if (event.success === false) pending.reject(new Error(String(event.error ?? "Pi request failed")));
        else pending.resolve(event.data ?? event);
        return;
      }
    }
    this.emit(event);
  }

  async request<T>(command: Record<string, unknown>, timeout = 35_000): Promise<T> {
    if (!isTauri()) {
      if (!this.connected) throw new Error("Pi runtime is not connected");
      return this.demoRequest<T>(command);
    }
    if (!this.connected && this.context) {
      try { await this.start(this.context.cwd, this.context.piPath); } catch { /* surfaced below */ }
    }
    if (!this.connected) throw new Error(this.recentStderr() || "Pi runtime is not connected");
    const id = `req_${++this.requestSequence}`;
    const payload = { ...command, id };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi request timed out: ${String(command.type)}`));
      }, timeout);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    });
    try {
      await native.sendRpc(payload, this.instanceId);
    } catch (error) {
      this.pending.delete(id);
      this.connected = false;
      const detail = error instanceof Error ? error.message : String(error);
      this.emit({ type: "rpc_disconnected", code: undefined, error: detail });
      throw new Error(this.recentStderr() || detail);
    }
    return promise;
  }

  send(command: Record<string, unknown>) {
    if (!isTauri()) return this.demoRequest(command).then(() => undefined);
    return native.sendRpc(command, this.instanceId);
  }

  private async demoRequest<T>(command: Record<string, unknown>): Promise<T> {
    if (command.type === "get_available_models") {
      return { models: [
        { provider: "anthropic", id: "claude-sonnet-4-6", contextWindow: 200_000, reasoning: true },
        { provider: "openai-codex", id: "gpt-5.4", contextWindow: 400_000, reasoning: true },
        { provider: "minimax-cn", id: "MiniMax-M3", contextWindow: 200_000, reasoning: true },
      ] satisfies ModelInfo[] } as T;
    }
    if (command.type === "get_state") return { thinkingLevel: "medium", isStreaming: false, sessionId: "demo" } as T;
    if (command.type === "prompt") {
      const id = crypto.randomUUID();
      this.emit({ type: "agent_start" });
      this.emit({ type: "message_start", message: { id, role: "assistant", content: [] } });
      const script = [
        [180, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Inspecting the project structure and current implementation..." } }],
        [520, { type: "tool_execution_start", toolCallId: "demo-tool", toolName: "read", args: { path: "src/App.tsx" } }],
        [900, { type: "tool_execution_end", toolCallId: "demo-tool", result: "Read src/App.tsx", isError: false }],
        [1100, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "The workspace is ready. Pichamber is connected to the project and can stream Pi activity, inspect files, and run terminal commands without leaving this view." } }],
        [1650, { type: "message_end", message: { id, role: "assistant" } }],
        [1700, { type: "agent_end" }],
      ] as const;
      script.forEach(([delay, event]) => this.demoTimers.push(window.setTimeout(() => this.emit(event), delay)));
      return {} as T;
    }
    return {} as T;
  }

  async stop() {
    this.demoTimers.forEach(window.clearTimeout);
    this.demoTimers = [];
    this.pending.forEach((value) => {
      window.clearTimeout(value.timer);
      value.reject(new Error("Runtime stopped"));
    });
    this.pending.clear();
    if (this.startInFlight) { try { await this.startInFlight; } catch { /* swallow */ } }
    await this.teardownListeners();
    if (this.connected && isTauri()) await native.stopRpc(this.instanceId).catch(() => undefined);
    this.connected = false;
    this.stderrTail = "";
  }

  recentStderr(): string { return this.stderrTail; }
}