/**
 * Built-in slash command intercept for the WS prompt path.
 *
 * Mirrors `interactive-mode.js` in Pi's TUI: when the user submits a
 * message that matches a built-in slash command, run it locally before
 * it reaches the SDK's `prompt()` (where the only auto-handled variant
 * is an extension-registered command). Everything else — extension
 * commands, prompt templates, skill commands, raw user text — keeps
 * its existing flow through `runtime.prompt()`.
 *
 * Only built-ins that have a clean runtime counterpart get a branch
 * here. TUI-only flows like `/login` (OAuth selector), `/tree`
 * (TreeSelectorComponent), `/resume` (SessionSelectorComponent), etc.
 * intentionally have no entry — when the user sends them, the SDK gets
 * them as regular prompts and (in most cases) just hands them to the
 * model. The catalog in `runtime.ts > GUI_BUILTIN_COMMANDS` is the
 * surface shown in the web picker; this file is what actually runs.
 */
import type { SessionRuntime } from "./runtime";

export type BuiltinSlashCommand =
  | { kind: "compact"; customInstructions?: string }
  | { kind: "reload" };

/** Trim then match — `/reload ` with trailing whitespace should still
 *  hit the reload branch. The TUI checks raw text but its input already
 *  strips trailing whitespace before submission; pichamber's draft
 *  doesn't guarantee that. */
export const matchBuiltinSlashCommand = (text: string): BuiltinSlashCommand | null => {
  const trimmed = text.trim();
  if (trimmed === "/reload") return { kind: "reload" };
  if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
    // Slice from the exact "/compact " length so "/compact" + arbitrary
    // arg text (e.g. `/compact focus on file changes`) survives trim
    // without losing the instruction body. Empty body after trim
    // collapses to undefined, matching TUI's "no custom instructions".
    const slice = trimmed.startsWith("/compact ") ? trimmed.slice(9).trim() : "";
    const customInstructions = slice.length > 0 ? slice : undefined;
    return { kind: "compact", customInstructions };
  }
  return null;
};

/** Run the matched built-in against the runtime. Returns true when the
 *  message was handled and the caller should not forward to
 *  `runtime.prompt()`. Throws for unsupported backends so the WS layer
 *  can surface the error to the client. */
export const dispatchBuiltinSlashCommand = async (
  builtin: BuiltinSlashCommand,
  runtime: SessionRuntime,
): Promise<void> => {
  switch (builtin.kind) {
    case "compact":
      // `runtime.compact()` already exists and tolerates streaming (it
      // aborts the current turn first). No busy-state guard needed.
      await runtime.compact(builtin.customInstructions);
      return;
    case "reload":
      // TUI rejects reload during streaming/compaction with a warning
      // (`Wait for the current response to finish before reloading.`).
      // Throw so the WS layer can relay it to the client.
      if (runtime.isStreaming) {
        throw new Error("Wait for the current response to finish before reloading.");
      }
      if (runtime.isCompacting) {
        throw new Error("Wait for compaction to finish before reloading.");
      }
      await runtime.reload();
      return;
  }
};