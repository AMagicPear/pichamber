import { describe, expect, it } from "vitest";
import {
  applyEvent,
  assistantText,
  assistantThinking,
  assistantToolCalls,
  findToolResult,
  initialView,
} from "./events";
import type { AssistantMessage, UserMessage, TextContent, ThinkingContent, ToolCall } from "./types";

const user: UserMessage = {
  role: "user",
  content: "Hello",
  timestamp: 1000,
};

const assistantTextOnly: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Hi there" } as TextContent],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-opus-4-5",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 1001,
};

const assistantFull: AssistantMessage = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "Let me read the file." } as ThinkingContent,
    { type: "toolCall", id: "tc1", name: "read", arguments: { path: "README.md" } } as ToolCall,
    { type: "text", text: "Here's what I found." } as TextContent,
  ],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-opus-4-5",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "toolUse",
  timestamp: 1002,
};

describe("applyEvent", () => {
  it("starts with an empty view", () => {
    const v = initialView();
    expect(v.messages).toEqual([]);
    expect(v.state.isStreaming).toBe(false);
  });

  it("appends message_start, replaces on message_update, finalizes on message_end", () => {
    let v = initialView();
    v = applyEvent(v, { type: "message_start", message: user });
    v = applyEvent(v, { type: "message_start", message: assistantTextOnly });
    expect(v.messages).toHaveLength(2);
    v = applyEvent(v, { type: "message_update", message: { ...assistantTextOnly, content: [{ type: "text", text: "Hi there updated" } as TextContent] } });
    expect(v.messages[1].content[0]).toMatchObject({ type: "text", text: "Hi there updated" });
    v = applyEvent(v, { type: "message_end", message: assistantTextOnly });
    expect(v.messages[1].content[0]).toMatchObject({ type: "text", text: "Hi there" });
  });

  it("tracks running tools", () => {
    let v = initialView();
    v = applyEvent(v, { type: "message_start", message: assistantFull });
    v = applyEvent(v, { type: "tool_execution_start", toolCallId: "tc1", toolName: "read", args: { path: "README.md" } });
    expect(v.runningTools.get("tc1")?.toolName).toBe("read");
    v = applyEvent(v, { type: "tool_execution_end", toolCallId: "tc1", result: "file contents", isError: false });
    expect(v.runningTools.get("tc1")?.result).toBe("file contents");
  });

  it("surfaces dialog UI requests but not status/notify", () => {
    let v = initialView();
    v = applyEvent(v, { type: "extension_ui_request", id: "q1", method: "confirm", title: "Continue?" });
    expect(v.uiRequest).toMatchObject({ method: "confirm" });
    v = applyEvent(v, { type: "extension_ui_request", id: "n1", method: "notify", message: "hi" });
    expect(v.uiRequest?.method).toBe("confirm"); // unchanged
  });

  it("mirrors thinking_level_changed and model_select into state", () => {
    let v = initialView();
    v = applyEvent(v, { type: "thinking_level_changed", level: "high" });
    v = applyEvent(v, { type: "model_select", model: { id: "m1", name: "M1", api: "anthropic-messages", provider: "anthropic", baseUrl: "x", reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 8192 } });
    expect(v.state.thinkingLevel).toBe("high");
    expect(v.state.model?.id).toBe("m1");
  });
});

describe("assistant helpers", () => {
  it("extracts text, thinking, and tool calls from content", () => {
    expect(assistantText(assistantFull)).toBe("Here's what I found.");
    expect(assistantThinking(assistantFull)).toBe("Let me read the file.");
    expect(assistantToolCalls(assistantFull)).toHaveLength(1);
  });
});

describe("findToolResult", () => {
  it("finds a toolResult by toolCallId in a flat message list", () => {
    const result = { role: "toolResult" as const, toolCallId: "tc1", toolName: "read", content: [{ type: "text" as const, text: "ok" }], isError: false, timestamp: 1003 };
    const list: Array<typeof user | typeof assistantFull | typeof result> = [user, assistantFull, result];
    expect(findToolResult(list, "tc1")?.timestamp).toBe(1003);
    expect(findToolResult(list, "missing")).toBeUndefined();
  });
});
