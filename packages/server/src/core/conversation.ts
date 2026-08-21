/**
 * Conversation → official AgentMessage[] conversion.
 *
 * The client's conversation view is derived from the same authoritative
 * session entries the TUI renders, using pi's own conversion helpers:
 * `buildContextEntries()` (compaction-aware path) + `sessionEntryToContextMessages()`
 * (compaction summaries, custom messages, branch summaries → official
 * `AgentMessage` roles). We no longer mint any custom item protocol.
 */
import { buildContextEntries, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Ordered, compaction-aware official message list for one session. */
export const conversationMessages = (entries: SessionEntry[]): AgentMessage[] =>
  buildContextEntries(entries).flatMap(sessionEntryToContextMessages);
