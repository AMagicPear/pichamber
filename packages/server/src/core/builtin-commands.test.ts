import { describe, expect, test } from "bun:test";
import { matchBuiltinSlashCommand } from "./builtin-commands";

describe("matchBuiltinSlashCommand", () => {
  test("matches exact /reload", () => {
    expect(matchBuiltinSlashCommand("/reload")).toEqual({ kind: "reload" });
  });

  test("/reload trims surrounding whitespace", () => {
    expect(matchBuiltinSlashCommand("  /reload  ")).toEqual({ kind: "reload" });
    expect(matchBuiltinSlashCommand("\t/reload\n")).toEqual({ kind: "reload" });
  });

  test("/reload with trailing args is NOT a reload (TUI exact-match)", () => {
    // TUI checks `text === "/reload"` exactly — args would be a separate
    // command. Pichamber follows the same rule so an extension that
    // exposes a `/reload-something` doesn't collide with the built-in.
    expect(matchBuiltinSlashCommand("/reload foo")).toBeNull();
  });

  test("/compact with no args", () => {
    expect(matchBuiltinSlashCommand("/compact")).toEqual({ kind: "compact" });
  });

  test("/compact with custom instructions", () => {
    expect(matchBuiltinSlashCommand("/compact focus on diffs")).toEqual({
      kind: "compact",
      customInstructions: "focus on diffs",
    });
  });

  test("/compact empty args collapse to undefined", () => {
    expect(matchBuiltinSlashCommand("/compact ")).toEqual({ kind: "compact" });
    expect(matchBuiltinSlashCommand("/compact  ")).toEqual({
      kind: "compact",
      customInstructions: undefined,
    });
  });

  test("/compact trims internal whitespace of instruction body", () => {
    expect(matchBuiltinSlashCommand("/compact   focus   ")).toEqual({
      kind: "compact",
      customInstructions: "focus",
    });
  });

  test("non-builtin slash commands fall through", () => {
    expect(matchBuiltinSlashCommand("/help")).toBeNull();
    expect(matchBuiltinSlashCommand("/model")).toBeNull();
    expect(matchBuiltinSlashCommand("/compact-foo")).toBeNull();
    expect(matchBuiltinSlashCommand("/reload-all")).toBeNull();
  });

  test("non-slash text falls through", () => {
    expect(matchBuiltinSlashCommand("hello")).toBeNull();
    expect(matchBuiltinSlashCommand("")).toBeNull();
    expect(matchBuiltinSlashCommand("   ")).toBeNull();
  });

  test("extension commands fall through (handled inside SDK prompt)", () => {
    // Extension-registered commands reach the runtime through
    // `runtime.prompt()` → `AgentSession._tryExecuteExtensionCommand`,
    // not through this matcher.
    expect(matchBuiltinSlashCommand("/my-extension-cmd")).toBeNull();
  });
});