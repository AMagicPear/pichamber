import { getLastAssistantUsage, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { LastAssistantUsage, ModelDescriptor, SessionStatsView } from "@amagicpear/pichamber-shared";
import { providerName } from "../providers/providers";

const modelDescriptor = (runtime: AgentSessionRuntime): ModelDescriptor | undefined => {
  const model = runtime.session.model;
  if (!model) return undefined;
  return {
    provider: model.provider,
    providerName: providerName(runtime.session, model.provider),
    id: model.id,
    name: model.name,
    reasoning: Boolean(model.reasoning),
  };
};

const emptyUsage = (): LastAssistantUsage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

/** Epoch ms of the most recent entry, or null. Entries are append-ordered,
 *  so the last timestamp is the newest. */
const findModifiedTimestamp = (entries: SessionEntry[]): number | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const ts = entries[i]?.timestamp;
    if (typeof ts === "string") {
      const ms = new Date(ts).getTime();
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return null;
};

/** Build the raw stats view. No display strings: the client formats counts,
 *  ratios, and the timestamp in the active UI language. */
export const computeSessionStatsView = async (
  runtime: AgentSessionRuntime,
): Promise<SessionStatsView> => {
  const stats = runtime.session.getSessionStats();
  const entries = runtime.session.sessionManager.buildContextEntries();
  const sdkUsage = getLastAssistantUsage(entries);

  const lastAssistant: LastAssistantUsage = sdkUsage
    ? {
        input: sdkUsage.input ?? 0,
        output: sdkUsage.output ?? 0,
        reasoning: sdkUsage.reasoning ?? 0,
        cacheRead: sdkUsage.cacheRead ?? 0,
        cacheWrite: sdkUsage.cacheWrite ?? 0,
      }
    : emptyUsage();

  const totalRead = stats.tokens.cacheRead + stats.tokens.input;

  return {
    model: modelDescriptor(runtime),
    modified: findModifiedTimestamp(entries),
    context: {
      tokens: stats.contextUsage?.tokens ?? null,
      contextWindow: stats.contextUsage?.contextWindow ?? 0,
      percent: stats.contextUsage?.percent != null ? stats.contextUsage.percent / 100 : null,
    },
    messages: {
      total: stats.totalMessages,
      user: stats.userMessages,
      assistant: stats.assistantMessages,
    },
    cost: stats.cost,
    lastAssistant,
    cacheHit: totalRead > 0 ? stats.tokens.cacheRead / totalRead : null,
  };
};
