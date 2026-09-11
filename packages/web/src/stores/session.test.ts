import { afterEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import type { ServerMessage } from "@amagicpear/pichamber-shared";
import {
  activity,
  applyServerMessage,
  canContinue,
  conversation,
  lastAssistantModel,
  pending,
  resetSessionState,
  thinking,
} from "./session";

/** A minimal completed assistant message; the reducer only reads role/
 *  content/model/stopReason. */
const assistantMessage = (model: string): AgentMessage =>
  ({ role: "assistant", content: [], model, stopReason: "stop" }) as unknown as AgentMessage;

/** An in-flight assistant message as attached by mid-run snapshots (no
 *  stopReason yet). */
const streamingMessage = (): AgentMessage =>
  ({ role: "assistant", content: [], model: "model" }) as unknown as AgentMessage;

const snapshot = (seq = 0): ServerMessage => ({
  type: "snapshot",
  seq,
  activity: { phase: "idle" },
  pending: { steering: [], followUp: [] },
  canRestorePending: true,
  messages: [],
  messageEntryIds: [],
  availableModels: [],
  thinking: { level: "off", availableLevels: ["off"] },
  resources: { commands: [], tools: [], extensions: [], diagnostics: [], extensionInventoryAvailable: false },
});

describe("session protocol reducer", () => {
  afterEach(resetSessionState);

  test("derives the actual assistant model from the authoritative conversation", () => {
    applyServerMessage(snapshot(), () => {});
    applyServerMessage(
      { type: "message_start", seq: 1, message: assistantMessage("requested-alias") },
      () => {},
    );
    applyServerMessage(
      { type: "message_end", seq: 2, message: assistantMessage("provider-resolved-id") },
      () => {},
    );

    expect(conversation.value).toHaveLength(1);
    expect(lastAssistantModel.value).toBe("provider-resolved-id");
  });

  test("rejects a sequence gap without partially applying the event", () => {
    applyServerMessage(snapshot(), () => {});
    let resyncs = 0;
    applyServerMessage({ type: "agent_start", seq: 2 }, () => { resyncs += 1; });

    expect(resyncs).toBe(1);
    expect(activity.value).toEqual({ phase: "idle" });
  });

  test("derives activity, pending, and thinking from the official event stream", () => {
    applyServerMessage(snapshot(), () => {});
    applyServerMessage({ type: "agent_start", seq: 1 }, () => {});
    expect(activity.value).toEqual({ phase: "working" });

    applyServerMessage(
      { type: "queue_update", seq: 2, steering: ["a"], followUp: ["b"] },
      () => {},
    );
    expect(pending.value).toEqual({ steering: ["a"], followUp: ["b"] });

    applyServerMessage({ type: "thinking_level_changed", seq: 3, level: "high" }, () => {});
    expect(thinking.value.level).toBe("high");
  });

  test("keeps interleaved thinking and text deltas in their official content blocks", () => {
    applyServerMessage(snapshot(), () => {});
    applyServerMessage(
      { type: "message_start", seq: 1, message: assistantMessage("model") },
      () => {},
    );
    applyServerMessage(
      {
        type: "message_update",
        seq: 2,
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reasoning" },
      } as unknown as ServerMessage,
      () => {},
    );
    applyServerMessage(
      {
        type: "message_update",
        seq: 3,
        assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "answer" },
      } as unknown as ServerMessage,
      () => {},
    );

    const item = conversation.value[0];
    expect(item?.kind).toBe("message");
    if (item?.kind !== "message" || item.message.role !== "assistant") throw new Error("Expected assistant message");
    expect(item.message.content).toEqual([
      { type: "thinking", thinking: "reasoning" },
      { type: "text", text: "answer" },
    ]);
  });

  test("marks event-appended rows live until a snapshot folds them into history", () => {
    const message = assistantMessage("model");
    applyServerMessage(snapshot(), () => {});
    applyServerMessage({ type: "message_start", seq: 1, message }, () => {});
    expect(conversation.value[0]?.liveRun).toBe(true);

    applyServerMessage({ ...snapshot(1), messages: [message] }, () => {});
    expect(conversation.value[0]?.liveRun).toBe(false);
  });

  test("resumes streaming onto a mid-run snapshot's in-flight message after reconnect", () => {
    const inFlight = streamingMessage();
    applyServerMessage({ ...snapshot(), messages: [inFlight], messageEntryIds: [undefined] }, () => {});
    // 快照里没有 stopReason 的 assistant 消息 = 运行中重连带回来的流式消息。
    const item = conversation.value[0];
    expect(item?.kind).toBe("message");
    if (item?.kind !== "message") throw new Error("Expected message item");
    expect(item.streaming).toBe(true);
    expect(item.liveRun).toBe(true);

    // 重连后的 delta 续写到同一条目，message_end 正常收尾。
    applyServerMessage(
      {
        type: "message_update",
        seq: 1,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "continued" },
      } as unknown as ServerMessage,
      () => {},
    );
    applyServerMessage(
      {
        type: "message_end",
        seq: 2,
        message: { role: "assistant", content: [{ type: "text", text: "partialcontinued" }], model: "model", stopReason: "stop" },
      } as unknown as ServerMessage,
      () => {},
    );
    expect(conversation.value).toHaveLength(1);
    const settled = conversation.value[0];
    if (settled?.kind !== "message") throw new Error("Expected message item");
    expect(settled.streaming).toBe(false);
    expect(settled.message.content).toEqual([{ type: "text", text: "partialcontinued" }]);
  });

  test("appends a missed in-flight message on message_end when the snapshot lacks it", () => {
    // RPC runtime 的快照不附 streamingMessage：重连后第一条 message_end
    // 应补上消息，而不是静默丢弃。
    applyServerMessage(snapshot(), () => {});
    applyServerMessage(
      {
        type: "message_end",
        seq: 1,
        message: { role: "assistant", content: [], model: "model", stopReason: "stop" },
      } as unknown as ServerMessage,
      () => {},
    );
    expect(conversation.value).toHaveLength(1);
    const item = conversation.value[0];
    if (item?.kind !== "message") throw new Error("Expected message item");
    expect(item.streaming).toBe(false);
    expect(item.liveRun).toBe(true);
  });

  test("describes settlement and errors as effects instead of touching browser APIs", () => {
    applyServerMessage(snapshot(), () => {});
    applyServerMessage({ type: "agent_start", seq: 1 }, () => {});
    const settled = applyServerMessage({ type: "agent_settled", seq: 2 }, () => {});
    const failed = applyServerMessage({ type: "error", error: "transport failed" }, () => {});

    expect(settled).toEqual([{ type: "session-settled" }]);
    expect(failed).toEqual([{ type: "error", message: "transport failed" }]);
  });

  test("marks an unnaturally ended turn continuable, a completed one not", () => {
    applyServerMessage(snapshot(), () => {});
    let seq = 0;
    const endTurnWith = (stopReason: string) => {
      seq += 1;
      applyServerMessage({ type: "message_start", seq, message: { role: "assistant", content: [] } as unknown as AgentMessage }, () => {});
      seq += 1;
      applyServerMessage({ type: "message_end", seq, message: { role: "assistant", content: [], stopReason } as unknown as AgentMessage }, () => {});
    };

    endTurnWith("aborted");
    expect(canContinue.value).toBe(true);

    endTurnWith("error");
    expect(canContinue.value).toBe(true);

    // 工具执行中被打断的回合也以 toolUse 收尾（后跟错误 toolResult），
    // 与纯流式中断的 aborted 一样可继续。
    endTurnWith("toolUse");
    expect(canContinue.value).toBe(true);

    endTurnWith("stop");
    expect(canContinue.value).toBe(false);

    // 工作中一律不可继续（例如正常 turn 里工具运行时）。
    applyServerMessage({ type: "agent_start", seq: seq + 1 }, () => {});
    expect(canContinue.value).toBe(false);
  });
});
