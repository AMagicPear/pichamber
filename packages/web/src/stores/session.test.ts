import { afterEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import type { ServerMessage } from "@amagicpear/pichamber-shared";
import {
  activity,
  applyServerMessage,
  conversation,
  lastAssistantModel,
  pending,
  resetSessionState,
  thinking,
} from "./session";

/** A minimal assistant message; the reducer only reads role/content/model. */
const assistantMessage = (model: string): AgentMessage =>
  ({ role: "assistant", content: [], model }) as unknown as AgentMessage;

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

  test("describes settlement and errors as effects instead of touching browser APIs", () => {
    applyServerMessage(snapshot(), () => {});
    applyServerMessage({ type: "agent_start", seq: 1 }, () => {});
    const settled = applyServerMessage({ type: "agent_settled", seq: 2 }, () => {});
    const failed = applyServerMessage({ type: "error", error: "transport failed" }, () => {});

    expect(settled).toEqual([{ type: "session-settled" }]);
    expect(failed).toEqual([{ type: "error", message: "transport failed" }]);
  });
});
