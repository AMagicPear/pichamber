// ─────────────────────────────────────────────────────────────────────────────
// Thin wrapper over the pichamber HTTP + WebSocket transport. Sends JSON-RPC
// commands to `pi --mode rpc` (one child process per session) and routes
// events back. The protocol is defined in:
//   pi/packages/coding-agent/src/modes/rpc/rpc-types.ts
// ─────────────────────────────────────────────────────────────────────────────

import { findPi, rpcEventWs, sendRpc, startRpc, stopRpc } from "../api/client";
import type { RuntimeEvent } from "./types";

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

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class RpcClient {
  readonly instanceId: string;
  private generation = 0;
  private requestSequence = 0;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Set<EventListener>();
  private ws: WebSocket | null = null;
  private context?: ClientContext;
  private startInFlight: Promise<void> | null = null;
  connected = false;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  onEvent(listener: EventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: RuntimeEvent) {
    this.listeners.forEach((l) => l(event));
  }

  async start(cwd: string, piPath?: string) {
    this.context = { cwd, piPath: piPath?.trim() ? piPath : undefined };
    if (!this.startInFlight) {
      this.startInFlight = this.startInternal(this.context).finally(() => {
        this.startInFlight = null;
      });
    }
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("RPC start timed out")), 15_000),
    );
    return Promise.race([this.startInFlight, timeout]);
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

      const ws = rpcEventWs(this.instanceId);
      this.ws = ws;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) { settled = true; reject(new Error("WebSocket open timed out after 10s")); }
        }, 10_000);
        ws.onopen = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
        ws.onclose = (event) => {
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`WebSocket closed before opening (code ${event.code})`)); }
        };
        ws.onerror = () => { /* onclose will follow */ };
      });
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { instanceId: string; generation: number; line: string };
          if (data.instanceId !== this.instanceId || data.generation !== this.generation) return;
          try {
            this.handle(JSON.parse(data.line) as RuntimeEvent);
          } catch {
            this.emit({ type: "error", error: "Pi returned malformed JSON" });
          }
        } catch {
          /* ignore non-JSON frames */
        }
      };
      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;
        if (wasConnected) this.emit({ type: "rpc_disconnected" });
      };
      ws.onerror = () => { /* onclose will fire next */ };
    } catch (error) {
      await this.teardownWs();
      const detail = error instanceof Error ? error.message : String(error);
      this.emit({ type: "rpc_disconnected", error: detail });
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
    if (event.type === "response") {
      const id = (event as { id?: unknown }).id;
      if (typeof id === "string") {
        const pending = this.pending.get(id);
        if (pending) {
          window.clearTimeout(pending.timer);
          this.pending.delete(id);
          const e = event as unknown as { success?: boolean; data?: unknown; error?: string };
          if (e.success === false) pending.reject(new Error(String(e.error ?? "Pi request failed")));
          else pending.resolve(e.data ?? event);
          return;
        }
      }
    }
    this.emit(event);
  }

  async request<T>(command: Record<string, unknown>, timeout = 35_000): Promise<T> {
    if (!this.connected && this.context) {
      try { await this.start(this.context.cwd, this.context.piPath); } catch { /* surfaced below */ }
    }
    if (!this.connected) throw new Error("Pi runtime is not connected");

    const id = `req_${++this.requestSequence}`;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi request timed out: ${String(command.type)}`));
      }, timeout);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    });
    try {
      await sendRpc({ ...command, id }, this.instanceId);
    } catch (error) {
      this.pending.delete(id);
      this.connected = false;
      const detail = error instanceof Error ? error.message : String(error);
      this.emit({ type: "rpc_disconnected", error: detail });
      throw new Error(detail);
    }
    return promise;
  }

  send(command: Record<string, unknown>) {
    return sendRpc(command, this.instanceId);
  }

  async stop() {
    this.pending.forEach((value) => {
      window.clearTimeout(value.timer);
      value.reject(new Error("Runtime stopped"));
    });
    this.pending.clear();
    if (this.startInFlight) { try { await this.startInFlight; } catch { /* swallow */ } }
    await this.teardownWs();
    if (this.connected) await stopRpc(this.instanceId).catch(() => undefined);
    this.connected = false;
  }
}
