import { describe, expect, test } from "bun:test";
import { displayWidgetLines } from "./widget-lines";

describe("extension widget lines", () => {
  test("renders subagent RPC snapshots as compact status lines", () => {
    const payload = {
      kind: "pi-subagents.async-status-snapshot",
      version: 1,
      runs: [{
        id: "run-1",
        kind: "workflow",
        label: "scout, researcher",
        state: "running",
        children: [{ id: "repo", kind: "step", label: "repo", state: "running", activity: { toolCount: 3 } }],
      }],
      omitted: { runs: 0, children: 0, byteLimitExceeded: false },
    };
    expect(displayWidgetLines([`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(payload)}`])).toEqual([
      "scout, researcher - running",
      "  repo - running - 3 tools",
    ]);
  });

  test("hides inspect replies and malformed protocol payloads", () => {
    expect(displayWidgetLines(["PI_SUBAGENT_INSPECT_JSON:{}", "PI_SUBAGENT_ASYNC_JSON:{bad"])).toEqual([]);
  });

  test("preserves ordinary extension text", () => {
    expect(displayWidgetLines(["Indexing files"])).toEqual(["Indexing files"]);
  });
});
