/**
 * Conversation → LiveItem conversion.
 *
 * Reconstructs the unified item stream the client renders from the
 * authoritative session entries the runtime exposes. Shared by the WS
 * layer (`ws.ts`) and the delete/snapshot helpers in `session.ts` so
 * they all produce the same item ids and ordering.
 */
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { LiveItem } from "@pichamber/shared";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

const toolCallIdOf = (message: AgentMessage): string | undefined => {
  const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
  return typeof toolCallId === "string" ? toolCallId : undefined;
};

/** Collect `toolCall` arguments from assistant messages so reconstructed
 *  tool items can render their command/file labels. */
const collectToolCallArgs = (entries: SessionEntry[]) => {
  const toolCallArgs = new Map<string, unknown>();
  for (const entry of entries) {
    for (const message of sessionEntryToContextMessages(entry)) {
      if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "toolCall" &&
          typeof part.id === "string"
        ) {
          toolCallArgs.set(part.id, part.arguments);
        }
      }
    }
  }
  return toolCallArgs;
};

/**
 * Replay session entries into LiveItem[]. Already-known items keep
 * their client-side ids; the rest mint a stable `e:<entryId>` id so
 * reconnects don't reshuffle. The RPC runtime exercises the same path
 * with `getEntries()`-derived entries.
 */
export const conversationItems = (entries: SessionEntry[], existing: LiveItem[]): LiveItem[] => {
  const toolCallArgs = collectToolCallArgs(entries);

  const byMessage = new Map<AgentMessage, LiveItem>();
  const byToolCallId = new Map<string, LiveItem>();
  const byEntryId = new Map<string, LiveItem>();
  for (const item of existing) {
    if (item.kind === "tool") byToolCallId.set(item.tool.toolCallId, item);
    else if ((item.kind === "custom" || item.kind === "compaction") && item.entryId)
      byEntryId.set(item.entryId, item);
    else if (item.kind !== "compaction") byMessage.set(item.message, item);
  }

  const items: LiveItem[] = [];
  for (const entry of entries) {
    if (entry.type === "custom_message") {
      const prev = byEntryId.get(entry.id);
      if (prev) {
        items.push(prev);
      } else {
        const message = sessionEntryToContextMessages(entry)[0];
        if (message) {
          items.push({
            id: `e:${entry.id}`,
            kind: "custom",
            phase: "committed",
            message,
            entryId: entry.id,
          });
        }
      }
      continue;
    }
    if (entry.type === "compaction") {
      const prev = byEntryId.get(entry.id);
      if (prev) {
        items.push(prev);
      } else {
        items.push({
          id: `e:${entry.id}`,
          kind: "compaction",
          phase: "committed",
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
          timestamp: new Date(entry.timestamp).getTime(),
          entryId: entry.id,
        });
      }
      continue;
    }
    for (const message of sessionEntryToContextMessages(entry)) {
      if (message.role === "toolResult") {
        const toolCallId = toolCallIdOf(message);
        const prev = toolCallId ? byToolCallId.get(toolCallId) : undefined;
        if (prev && prev.kind === "tool") {
          items.push({ ...prev, message, phase: "committed" });
        } else if (toolCallId) {
          const isError = (message as { isError?: unknown }).isError === true;
          const toolName = (message as { toolName?: unknown }).toolName;
          items.push({
            id: `tool:${toolCallId}`,
            kind: "tool",
            phase: "committed",
            tool: {
              toolCallId,
              toolName: typeof toolName === "string" ? toolName : "",
              args: toolCallArgs.get(toolCallId),
              isError,
              running: false,
            },
            message,
          });
        }
      } else if (message.role === "user" || message.role === "assistant") {
        const prev = byMessage.get(message);
        if (prev && prev.kind !== "compaction") items.push({ ...prev, message, phase: "committed" });
        else items.push({ id: `e:${entry.id}`, kind: message.role, phase: "committed", message });
      }
    }
  }
  return items;
};