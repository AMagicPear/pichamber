import { describe, expect, it } from "vitest";
import { normalizeBackendMessages } from "./normalize";

describe("normalizeBackendMessages", () => {
  it("rehydrates text, thinking, and tool results", () => {
    const messages = normalizeBackendMessages([
      { id: "u1", role: "user", content: "Read it" },
      { id: "a1", role: "assistant", content: [{ type: "thinking", thinking: "Checking" }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "README.md" } }, { type: "text", text: "Done" }] },
      { role: "toolResult", toolCallId: "t1", content: "file contents" },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ text: "Done", thinking: "Checking" });
    expect(messages[1].tools[0]).toMatchObject({ name: "read", output: "file contents" });
  });
});
