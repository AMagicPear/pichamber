import { describe, expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { SessionStatsView } from "@amagicpear/pichamber-shared";
import { registerDriver } from "./session";
import { attachListener, detachListener, isSessionRunning } from "./ws";
import type { SessionDriver, SessionSnapshot } from "./driver";

/** Detach only touches the socket set; a bare object is enough. */
const fakeSocket = {} as Parameters<typeof detachListener>[1];

const emptyStats = (): SessionStatsView => ({
  model: undefined,
  modified: null,
  context: { tokens: null, contextWindow: 0, percent: null },
  messages: { total: 0, user: 0, assistant: 0 },
  cost: 0,
  lastAssistant: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  cacheHit: null,
});

const emptySnapshot = (): SessionSnapshot => ({
  messages: [],
  messageEntryIds: [],
  model: undefined,
  availableModels: [],
  thinking: { level: "off", availableLevels: ["off"] },
  stats: emptyStats(),
  activity: { phase: "idle" },
  pending: { steering: [], followUp: [] },
});

const createFakeDriver = (sessionId: string) => {
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const driver = {
    mode: "rpc" as const,
    sessionId,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    cwd: "/tmp",
    start: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    getSnapshot: () => Promise.resolve(emptySnapshot()),
    prompt: () => Promise.resolve(),
    continue: () => Promise.reject(new Error("not supported")),
    compact: () => Promise.resolve(),
    setModel: () => Promise.resolve(),
    setThinkingLevel: () => Promise.resolve(),
    subscribe: (listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let disposed = false;
  let prompts = 0;
  const fake = {
    ...driver,
    get disposed() {
      return disposed;
    },
    get prompts() {
      return prompts;
    },
    dispose: () => {
      disposed = true;
      return Promise.resolve();
    },
    prompt: () => {
      prompts += 1;
      return Promise.resolve();
    },
    emit: (event: AgentSessionEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
  return fake satisfies SessionDriver & { disposed: boolean; prompts: number; emit: (event: AgentSessionEvent) => void };
};

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

describe("session channel background keep-alive", () => {
  test("keeps the channel alive while the last browser detaches mid-run", async () => {
    const driver = createFakeDriver("session-1");
    registerDriver(driver);
    const channel = attachListener("session-1", driver);
    driver.emit({ type: "agent_start" });
    expect(channel.state.activity).toEqual({ phase: "working" });
    expect(isSessionRunning("session-1")).toBe(true);

    detachListener("session-1", fakeSocket);
    await flushAsync();
    // Run is still in flight — the channel and driver must stay alive.
    expect(isSessionRunning("session-1")).toBe(true);
    expect(driver.disposed).toBe(false);

    driver.emit({ type: "agent_settled" });
    await flushAsync();
    // Settled with no browser reattached — reclaim now.
    expect(isSessionRunning("session-1")).toBe(false);
    expect(driver.disposed).toBe(true);
  });

  test("does not reclaim on settle when the settle flushed queued work", async () => {
    const driver = createFakeDriver("session-2");
    registerDriver(driver);
    const channel = attachListener("session-2", driver);

    driver.emit({ type: "compaction_start", reason: "manual" });
    // compaction_start resets the buffer; queue after it, like the prompt
    // handler does for messages arriving mid-compaction.
    channel.compactionQueue = [{ text: "queued", mode: "steer" }];
    driver.emit({ type: "compaction_end", reason: "manual", result: undefined, aborted: false, willRetry: false });
    await flushAsync();
    // The flush fired a fresh prompt for the queued message — the background
    // turn is not over yet even though activity briefly reads idle.
    expect(driver.prompts).toBe(1);
    expect(driver.disposed).toBe(false);
  });

  test("reclaims an idle session after the detach grace period", async () => {
    const driver = createFakeDriver("session-3");
    registerDriver(driver);
    attachListener("session-3", driver);
    detachListener("session-3", fakeSocket);
    await flushAsync();
    // Inside the grace period the driver is still alive for a quick reload.
    expect(driver.disposed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect(driver.disposed).toBe(true);
  });

  test("replays pending extension dialogs to reattached clients", async () => {
    const driver = createFakeDriver("session-4");
    registerDriver(driver);
    const channel = attachListener("session-4", driver);

    const dialog = channel.uiBridge.context.confirm("Approve?", "run command");
    expect(channel.uiBridge.pendingRequests()).toHaveLength(1);

    const request = channel.uiBridge.pendingRequests()[0]!;
    channel.uiBridge.handleResponse({ type: "extension_ui_response", id: request.id, confirmed: true });
    await expect(dialog).resolves.toBe(true);
    expect(channel.uiBridge.pendingRequests()).toHaveLength(0);
  });
});
