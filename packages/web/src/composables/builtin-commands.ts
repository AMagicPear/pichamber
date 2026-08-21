/**
 * Frontend built-in slash command routing.
 *
 * Owns the mapping from typed built-in commands to their direct
 * operations. The WS protocol stays plain: a built-in never leaves the
 * client as a `prompt` message — `useConversationSession.prompt()` matches
 * here first and dispatches to `compact`/`reload` WS frames instead.
 * Everything else (extension commands, prompt templates, skill commands,
 * raw user text) keeps its existing flow through the `prompt` frame.
 *
 * Only built-ins with a clean GUI counterpart get a branch. TUI-only
 * flows like `/new`, `/name`, `/resume`, `/fork`, `/clone` intentionally
 * have no entry — the server's `GUI_BUILTIN_COMMANDS` still lists them
 * for the picker, but submitting them sends the text through to the
 * runtime as-is.
 */

/** A matched built-in command. `customInstructions` follows the naming the
 *  TUI's runtime reads out of `/compact …` (`interactive-mode.js`); `null`
 *  when the command carries no argument. */
export type BuiltinCommand = {
  name: string;
  customInstructions: string | null;
};

/** Built-ins with a direct GUI operation, in match-priority order. */
const GUI_BUILTIN_COMMANDS = ["reload", "compact"] as const;

/** Trim then match by prefix — `/reload ` with trailing whitespace still
 *  hits the reload branch, and any text starting with `/compact` is
 *  treated as a compact with that instruction body. */
export const matchBuiltinCommand = (text: string): BuiltinCommand | null => {
  const trimmed = text.trim();
  for (const name of GUI_BUILTIN_COMMANDS) {
    if (trimmed.startsWith(`/${name}`)) {
      const customInstructions = trimmed.slice(name.length + 1).trim();
      return { name, customInstructions: customInstructions || null };
    }
  }
  return null;
};
