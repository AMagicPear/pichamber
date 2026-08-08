import type { AgentSessionEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ConversationMessage } from "@pichamber/shared";

export const toConversationMessage = (
  id: string,
  payload: SessionEntry | AgentSessionEvent,
): ConversationMessage => ({
  id,
  timestamp:
    "timestamp" in payload && typeof payload.timestamp === "string"
      ? payload.timestamp
      : new Date().toISOString(),
  payload,
});
