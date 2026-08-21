/**
 * Browser-safe reimplementation of pi's skill block parser.
 *
 * The browser bundle cannot import the `@earendil-works/pi-coding-agent`
 * package — its top-level evaluation path references `process.env` and
 * other Node globals, which Vite refuses to shim. The parser itself is
 * pure-string (a single regex match), so duplicating it here keeps the
 * chat-list rendering path independent of the Node-side SDK while
 * staying byte-identical to the canonical form produced by
 * `AgentSession._expandSkillCommand` on the server.
 *
 * The canonical text shape produced on submit is:
 *
 *   <skill name="<name>" location="<file>">
 *   References are relative to <dir>.
 *
 *   <body>
 *   </skill>
 *
 * Optionally followed by a blank line + the user's trailing text.
 */
export interface SkillBlock {
  name: string;
  location: string;
  /** Skill body content (without the surrounding tags). */
  body: string;
  /** Anything the user typed after the skill block, if any. */
  userMessage?: string;
}

const SKILL_BLOCK_RE =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

export const parseSkillBlock = (text: string): SkillBlock | null => {
  const match = SKILL_BLOCK_RE.exec(text);
  if (!match) return null;
  const userMessage = match[4]?.trim();
  return {
    name: match[1] ?? "",
    location: match[2] ?? "",
    body: match[3] ?? "",
    ...(userMessage ? { userMessage } : {}),
  };
};
