import { describe, expect, test } from "bun:test";
import { normalizeExtensionWidget } from "./widget-lines";

describe("structured extension widgets", () => {
  test("retains task tree ids, activity, and hierarchy", () => {
    const payload = {
      kind: "pi-subagents.async-status-snapshot",
      version: 1,
      runs: [{
        id: "run-1", kind: "workflow", label: "workflow", state: "running",
        activity: { currentTool: "bash", toolCount: 2 },
        children: [{ id: "step-1", kind: "step", label: "repo", state: "complete" }],
      }],
    };
    const widget = normalizeExtensionWidget({
      type: "extension_ui_request", id: "1", method: "setWidget", widgetKey: "x",
      widgetLines: [`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(payload)}`],
    });
    expect(widget).toEqual({
      kind: "task-tree",
      runs: [{
        id: "run-1", kind: "workflow", label: "workflow", state: "running",
        activity: { currentTool: "bash", toolCount: 2 },
        children: [{ id: "step-1", kind: "step", label: "repo", state: "complete" }],
      }],
    });
  });

  test("keeps ordinary widget lines and consumes inspect payloads", () => {
    expect(normalizeExtensionWidget({
      type: "extension_ui_request", id: "1", method: "setWidget", widgetKey: "x",
      widgetLines: ["hello", "PI_SUBAGENT_INSPECT_JSON:{}"],
    })).toEqual({ kind: "lines", lines: ["hello"] });
  });

  test("drops malformed machine payloads instead of displaying protocol text", () => {
    expect(normalizeExtensionWidget({
      type: "extension_ui_request", id: "1", method: "setWidget", widgetKey: "x",
      widgetLines: ["PI_SUBAGENT_ASYNC_JSON:{bad"],
    })).toBeUndefined();
  });

  test("drops invalid activity fields and retains omission counts", () => {
    const payload = {
      kind: "pi-subagents.async-status-snapshot",
      version: 1,
      runs: [{
        id: "run-1",
        kind: "subagent",
        label: "worker",
        state: "running",
        activity: { currentTool: 42, toolCount: "many", turnCount: 3 },
      }],
      omitted: { runs: 1, children: 2 },
    };
    expect(normalizeExtensionWidget({
      type: "extension_ui_request",
      id: "1",
      method: "setWidget",
      widgetKey: "x",
      widgetLines: [`PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(payload)}`],
    })).toEqual({
      kind: "task-tree",
      runs: [{
        id: "run-1",
        kind: "subagent",
        label: "worker",
        state: "running",
        activity: { turnCount: 3 },
      }],
      omitted: 3,
    });
  });
});
