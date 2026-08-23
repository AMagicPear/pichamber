import { describe, expect, test } from "bun:test";
import type { RpcClient } from "@earendil-works/pi-coding-agent";
import { RpcSessionDriver } from "./driver";

const stats = {
  sessionFile: "/tmp/session.jsonl",
  sessionId: "session-1",
  userMessages: 1,
  assistantMessages: 1,
  toolCalls: 0,
  toolResults: 0,
  totalMessages: 2,
  tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, total: 17 },
  cost: 0.01,
};

class FakeRpcClient {
  options: unknown;
  readonly events = new Set<(event: unknown) => void>();
  starts = 0;
  stops = 0;
  constructor(options: unknown) {
    this.options = options;
  }
  async start() { this.starts += 1; }
  async stop() { this.stops += 1; }
  onEvent(listener: (event: unknown) => void) {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }
  emit(event: unknown) {
    for (const listener of this.events) listener(event);
  }
  async abort() {}
  async prompt() {}
  async steer() {}
  async followUp() {}
  async compact() { return {}; }
  async setModel() { return { provider: "test", id: "model" }; }
  async setThinkingLevel() {}
  async getState() {
    return {
      model: { provider: "test", id: "model", name: "Test", reasoning: false },
      thinkingLevel: "off",
      isStreaming: false,
      isCompacting: false,
      sessionId: "session-1",
      pendingMessageCount: 0,
    };
  }
  async getMessages() { return []; }
  async getAvailableModels() { return [{ provider: "test", id: "model", reasoning: false }]; }
  async getAvailableThinkingLevels() { return ["off"]; }
  async getSessionStats() { return stats; }
}

const createDriver = (client: FakeRpcClient) =>
  new RpcSessionDriver("session-1", "/tmp/session.jsonl", "/tmp", (options) => {
    client.options = options;
    return client as unknown as RpcClient;
  });

describe("RpcSessionDriver", () => {
  test("starts with the same cwd and session file and builds its snapshot from RPC state", async () => {
    const client = new FakeRpcClient(undefined);
    const driver = createDriver(client);
    await driver.start();

    expect(client.starts).toBe(1);
    expect(client.options).toMatchObject({ cwd: "/tmp", args: ["--session", "/tmp/session.jsonl"] });
    const snapshot = await driver.getSnapshot();
    expect(snapshot.model?.id).toBe("model");
    expect(snapshot.availableModels).toHaveLength(1);
    expect(snapshot.stats.messages.total).toBe(2);
    expect(snapshot.pending).toEqual({ steering: [], followUp: [] });
  });

  test("forwards official JSON events without reshaping them", async () => {
    const client = new FakeRpcClient(undefined);
    const driver = createDriver(client);
    const received: unknown[] = [];
    await driver.start();
    driver.subscribe((event) => received.push(event));

    const messageUpdate = {
      type: "message_update",
      usage: { input: 1 },
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi" },
    };
    client.emit(messageUpdate);
    client.emit({ type: "message_end", message: { role: "assistant" } });
    client.emit({ type: "agent_settled" });

    expect(received).toEqual([messageUpdate, { type: "message_end", message: { role: "assistant" } }, { type: "agent_settled" }]);
  });

  test("stops a partially started client when startup fails", async () => {
    const client = new FakeRpcClient(undefined);
    client.start = async () => { throw new Error("cannot start"); };
    const driver = createDriver(client);

    await expect(driver.start()).rejects.toThrow("cannot start");
    expect(client.stops).toBe(1);
  });
});
