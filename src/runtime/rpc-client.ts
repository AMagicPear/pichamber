import {
  findPi,
  rpcEventWs,
  sendRpc,
  startRpc,
  stopRpc,
} from "../api/client";
import type { ModelInfo, RuntimeEvent } from "./types";

type EventListener = (event: RuntimeEvent) => void;

interface ClientContext {
  cwd: string;
  piPath?: string;
}

let piPathCached: string | undefined;

async function resolvePi(piPath?: string): Promise<string> {
  if (piPathCached) return piPathCached;
  piPathCached = await findPi(piPath);
  return piPathCached;
}

export class RpcClient {
  readonly instanceId: string;
  private generation = 0;
  private requestSequence = 0;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
  private listeners = new Set<EventListener>();
  private ws: WebSocket | null = null;
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
    if (!this.startInFlight) {
      this.startInFlight = this.startInternal(this.context).finally(() => {
        this.startInFlight = null;
      });
    }
    return this.startInFlight;
  }

  private async startInternal(context: ClientContext) {
    await this.teardownWs();

    try {
      await resolvePi(context.piPath);
      const result = await startRpc(
        { cwd: context.cwd, piPath: context.piPath },
        this.instanceId,
      );
      this.generation = result.generation;
      this.connected = true;
      this.emit({ type: "rpc_connected", discovery: result.executable });

      // Connect WebSocket for events
      const ws = rpcEventWs(this.instanceId);
      this.ws = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            instanceId: string;
            generation: number;
            line: string;
          };
          if (data.instanceId !== this.instanceId || data.generation !== this.generation)
            return;
          try {
            this.handle(JSON.parse(data.line) as RuntimeEvent);
          } catch {
            this.emit({
              type: "error",
              error: "Pi returned malformed JSON",
              raw: data.line,
            });
          }
        } catch {
          // Ignore non-JSON messages
        }
      };
      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;
        if (wasConnected) this.emit({ type: "rpc_disconnected" });
      };
      ws.onerror = () => {
        // onclose will fire next
      };
    } catch (error) {
      await this.teardownWs();
      const detail = error instanceof Error ? error.message : String(error);
      this.emit({ type: "rpc_disconnected", code: undefined, error: detail });
      throw error;
    }
  }

  private async teardownWs() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.close();
    }
  }

  private handle(event: RuntimeEvent) {
    if (event.type === "response" && typeof event.id === "string") {
      const pending = this.pending.get(event.id);
      if (pending) {
        window.clearTimeout(pending.timer);
        this.pending.delete(event.id);
        if (event.success === false)
          pending.reject(
            new Error(String(event.error ?? "Pi request failed")),
          );
        else pending.resolve(event.data ?? event);
        return;
      }
    }
    this.emit(event);
  }

  async request<T>(command: Record<string, unknown>, timeout = 35_000): Promise<T> {
    if (!this.connected && this.context) {
      try {
        await this.start(this.context.cwd, this.context.piPath);
      } catch {
        /* surfaced below */
      }
    }
    if (!this.connected) {
      // If we can't connect, try the demo fallback
      try {
        await resolvePi();
      } catch {
        return this.demoRequest<T>(command);
      }
      throw new Error(
        this.recentStderr() || "Pi runtime is not connected",
      );
    }
    const id = `req_${++this.requestSequence}`;
    const payload = { ...command, id };
    const promise = new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Pi request timed out: ${String(command.type)}`),
        );
      }, timeout);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
    });
    try {
      await sendRpc(payload, this.instanceId);
    } catch (error) {
      this.pending.delete(id);
      this.connected = false;
      const detail =
        error instanceof Error ? error.message : String(error);
      this.emit({
        type: "rpc_disconnected",
        code: undefined,
        error: detail,
      });
      throw new Error(this.recentStderr() || detail);
    }
    return promise;
  }

  send(command: Record<string, unknown>) {
    return sendRpc(command, this.instanceId);
  }

  private async demoRequest<T>(command: Record<string, unknown>): Promise<T> {
    if (command.type === "get_available_models") {
      return {
        models: [
          {
            provider: "anthropic",
            id: "claude-sonnet-4-6",
            contextWindow: 200_000,
            reasoning: true,
          },
          {
            provider: "openai-codex",
            id: "gpt-5.4",
            contextWindow: 400_000,
            reasoning: true,
          },
          {
            provider: "minimax-cn",
            id: "MiniMax-M3",
            contextWindow: 200_000,
            reasoning: true,
          },
        ] satisfies ModelInfo[],
      } as T;
    }
    if (command.type === "get_state")
      return {
        thinkingLevel: "medium",
        isStreaming: false,
        sessionId: "demo",
        model: { provider: "anthropic", id: "claude-sonnet-4-6" },
      } as T;
    if (command.type === "prompt") {
      const id = crypto.randomUUID();
      this.emit({ type: "agent_start" });
      this.emit({
        type: "message_start",
        message: { id, role: "assistant", content: [] },
      });
      const script = [
        [
          180,
          {
            type: "message_update",
            assistantMessageEvent: {
              type: "thinking_delta",
              delta:
                "Inspecting the project structure and current implementation...",
            },
          },
        ],
        [
          520,
          {
            type: "tool_execution_start",
            toolCallId: "demo-tool",
            toolName: "read",
            args: { path: "src/App.tsx" },
          },
        ],
        [
          900,
          {
            type: "tool_execution_end",
            toolCallId: "demo-tool",
            result: "Read src/App.tsx",
            isError: false,
          },
        ],
        [
          1100,
          {
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              delta:
                "The workspace is ready. Pichamber streams Pi activity, inspects files, and runs terminal commands — all without leaving this view.\n\n## Quick start\n\n```typescript\nimport { useAppStore } from './stores/app-store';\n\nconst state = useAppStore();\nstate.addProject({ id: 'demo', name: 'Pichamber', path: '/projects/pichamber' });\n```\n\n### Features\n\n| Feature | Status | Notes |\n|---|---|---|\n| Chat streaming | ✓ | Real-time Pi RPC events |\n| File inspector | ✓ | Workspace-scoped tree |\n| Terminal | ✓ | portable-pty + xterm.js |\n| Markdown | ✓ | marked + GFM tables |\n\n> **Tip:** Press `Cmd+K` to open the command palette. Shift+Enter for newlines in the composer.",
            },
          },
        ],
        [
          1650,
          {
            type: "message_end",
            message: { id, role: "assistant" },
          },
        ],
        [1700, { type: "agent_end" }],
      ] as const;
      script.forEach(([delay, event]) =>
        this.demoTimers.push(
          window.setTimeout(() => this.emit(event), delay),
        ),
      );
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
    if (this.startInFlight) {
      try {
        await this.startInFlight;
      } catch {
        /* swallow */
      }
    }
    await this.teardownWs();
    if (this.connected) await stopRpc(this.instanceId).catch(() => undefined);
    this.connected = false;
    this.stderrTail = "";
  }

  recentStderr(): string {
    return this.stderrTail;
  }
}
