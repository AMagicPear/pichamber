import { describe, expect, test } from "bun:test";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type AgentSessionRuntime, type RpcClient } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { RpcSessionDriver, SdkSessionDriver } from "./driver";

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
      sessionFile: "/tmp/session.jsonl",
      pendingMessageCount: 0,
    };
  }
  async getMessages() { return []; }
  async getAvailableModels() { return [{ provider: "test", id: "model", reasoning: false }]; }
  async getAvailableThinkingLevels() { return ["off"]; }
  async getSessionStats() { return stats; }
}

const createDriver = (client: FakeRpcClient) =>
  new RpcSessionDriver({ sessionId: "session-1", sessionFile: "/tmp/session.jsonl", cwd: "/tmp" }, (options) => {
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

  test("creates a new persistent session by id and adopts the RPC session file", async () => {
    const client = new FakeRpcClient(undefined);
    const driver = new RpcSessionDriver({ sessionId: "session-1", cwd: "/tmp" }, (options) => {
      client.options = options;
      return client as unknown as RpcClient;
    });
    await driver.start();

    expect(client.options).toMatchObject({ cwd: "/tmp", args: ["--session-id", "session-1"] });
    expect(driver.sessionFile).toBe("/tmp/session.jsonl");
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

test("SDK continuation omits the failed attempt from canonical context and runs settle boundaries", async () => {
  const model: Model<"openai-responses"> = { provider: "mock", id: "mock", name: "Mock", api: "openai-responses", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1000 };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const failed: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "failed attempt" }], provider: "mock", model: "mock", api: "openai-responses", usage, stopReason: "aborted", timestamp: 1 };
  const manager = SessionManager.inMemory(process.cwd());
  manager.appendMessage({ role: "user", content: "question", timestamp: 0 });
  const failedId = manager.appendMessage(failed);
  let boundaries = 0;
  const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: "/nonexistent-pichamber-test-agent", noContextFiles: true, noSkills: true, noPromptTemplates: true, extensionFactories: [(pi) => {
    pi.on("agent_before_settle", () => {
      boundaries += 1;
      if (boundaries === 1) return { entries: [{ type: "custom_message", customType: "continue-test", content: "one more turn", display: false }], continue: true };
    });
  }] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: process.cwd(), agentDir: "/nonexistent-pichamber-test-agent", resourceLoader: loader, settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }), sessionManager: manager, model });
  const requests: unknown[] = [];
  const events: string[] = [];
  session.agent.streamFunction = (_model, context) => {
    requests.push(context.messages);
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message: { ...failed, content: [{ type: "text", text: "resumed" }], stopReason: "stop", timestamp: 2 } });
    return stream;
  };
  session.subscribe((event) => events.push(event.type));
  const driver = new SdkSessionDriver(manager.getSessionId(), "", process.cwd(), async () => ({ session }) as AgentSessionRuntime);
  await driver.start();
  try {
    await session.bindExtensions({});
    await driver.continue();
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests)).not.toContain("failed attempt");
    expect(manager.getEntry(failedId)?.type).toBe("message");
    expect(manager.getBranch()).toContainEqual(expect.objectContaining({ type: "context_edit", targetId: failedId, replacement: null }));
    expect(events.filter((event) => event === "agent_settled")).toHaveLength(1);
    expect(manager.getBranch().filter((entry) => entry.type === "message" && entry.message.role === "user")).toHaveLength(1);
  } finally { session.dispose(); }
});
