import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";

describe("runtime event reducer", () => {
  beforeEach(() => useAppStore.setState({ projects: [], sessions: [], messages: {}, activeAssistant: {}, runtimeError: undefined }));

  it("merges streamed text and tools into one assistant turn", () => {
    const session = useAppStore.getState().addSession("project");
    const reduce = useAppStore.getState().reduceRuntimeEvent;
    reduce(session.id, { type: "message_start", message: { id: "a1", role: "assistant", content: [] } });
    reduce(session.id, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } });
    reduce(session.id, { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "README.md" } });
    reduce(session.id, { type: "tool_execution_end", toolCallId: "t1", result: "done" });
    reduce(session.id, { type: "message_end" });
    const message = useAppStore.getState().messages[session.id][0];
    expect(message.text).toBe("Hello");
    expect(message.tools[0]).toMatchObject({ id: "t1", status: "complete", output: "done" });
    expect(message.streaming).toBe(false);
  });

  it("surfaces extension UI requests", () => {
    const session = useAppStore.getState().addSession("project");
    useAppStore.getState().reduceRuntimeEvent(session.id, { type: "extension_ui_request", id: "q1", method: "confirm", title: "Continue?" });
    expect(useAppStore.getState().uiRequest).toMatchObject({ id: "q1", method: "confirm" });
  });
});
