import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { RpcMessageStream } from "./rpc-message-stream";

const usage: Usage = {
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 3,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const message: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "openai-completions",
  provider: "test",
  model: "test-model",
  usage,
  stopReason: "pending",
  timestamp: 1,
};

describe("RPC message stream", () => {
  test("assembles delta-only text and thinking updates", () => {
    const stream = new RpcMessageStream();
    stream.normalize({ type: "message_start", message });

    const updates: JsonAgentSessionEvent[] = [
      { type: "message_update", usage, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
      { type: "message_update", usage, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "why" } },
      { type: "message_update", usage, assistantMessageEvent: { type: "text_start", contentIndex: 1 } },
      { type: "message_update", usage, assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "hel" } },
      { type: "message_update", usage, assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "lo" } },
    ];
    const normalized = updates.map((event) => stream.normalize(event));
    const last = normalized.at(-1);

    expect(last?.type).toBe("message_update");
    if (last?.type !== "message_update") throw new Error("expected message update");
    expect(last.message.role).toBe("assistant");
    if (last.message.role !== "assistant") throw new Error("expected assistant message");
    expect(last.message.content).toEqual([
      { type: "thinking", thinking: "why" },
      { type: "text", text: "hello" },
    ]);
    if (last.assistantMessageEvent.type !== "text_delta") throw new Error("expected text delta");
    expect(last.assistantMessageEvent.partial).toBe(last.message);
  });

  test("ignores orphan deltas instead of emitting a message without a role", () => {
    const stream = new RpcMessageStream();
    expect(stream.normalize({
      type: "message_update",
      usage,
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "orphan" },
    })).toBeUndefined();
  });
});
