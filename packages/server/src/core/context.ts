import {
  getLastAssistantUsage,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { LastAssistantUsage, ModelDescriptor, SessionStatsView } from "@pichamber/shared";
import type { SessionRuntime } from "./runtime";

const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const formatPercent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
const formatCost = (raw: number) => `$${raw.toFixed(2)}`;

const modelDescriptor = (
  runtime: SessionRuntime,
): ModelDescriptor | undefined => {
  const model = runtime.getCurrentModel();
  if (!model) return undefined;
  return {
    provider: model.provider,
    providerName: model.providerName,
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
  };
};

const emptyUsage = (): LastAssistantUsage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

/** Compute the modified date from the active branch. */
const findModifiedDate = (entries: SessionEntry[]): Date | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const ts = entries[i]?.timestamp;
    if (typeof ts === "string") {
      const ms = new Date(ts).getTime();
      if (!Number.isNaN(ms)) return new Date(ms);
    }
  }
  return null;
};

/** Build the ready-to-render stats view. All display strings (date,
 *  percent, cost, cache hit, comma-grouped tokens) are produced here per
 *  the project's "server computes display strings" rule. The `cost.raw`
 *  field is included so a future sortable cost column wouldn't need a
 *  second pass over the session. */
export const computeSessionStatsView = async (
  runtime: SessionRuntime,
): Promise<SessionStatsView> => {
  const stats = await runtime.getSessionStats();
  const entries = await runtime.buildConversationEntries();
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

  const modifiedDate = findModifiedDate(entries);
  const totalRead = stats.tokens.cacheRead + stats.tokens.input;
  const cacheHit = totalRead > 0 ? formatPercent(stats.tokens.cacheRead / totalRead) : "0.0%";

  return {
    model: modelDescriptor(runtime),
    modified: modifiedDate ? dateFormat.format(modifiedDate) : "",
    context: {
      tokens: stats.contextUsage?.tokens ?? null,
      contextWindow: stats.contextUsage?.contextWindow ?? 0,
      percent:
        stats.contextUsage?.percent != null
          ? formatPercent(stats.contextUsage.percent / 100)
          : null,
      tokensText:
        stats.contextUsage?.tokens != null ? numberFormat.format(stats.contextUsage.tokens) : "—",
    },
    messages: {
      total: stats.totalMessages,
      user: stats.userMessages,
      assistant: stats.assistantMessages,
      totalText: numberFormat.format(stats.totalMessages),
      userText: numberFormat.format(stats.userMessages),
      assistantText: numberFormat.format(stats.assistantMessages),
    },
    cost: { value: formatCost(stats.cost), raw: stats.cost },
    lastAssistant,
    lastAssistantText: {
      input: numberFormat.format(lastAssistant.input),
      output: numberFormat.format(lastAssistant.output),
      reasoning: numberFormat.format(lastAssistant.reasoning),
      cacheRead: numberFormat.format(lastAssistant.cacheRead),
      cacheWrite: numberFormat.format(lastAssistant.cacheWrite),
    },
    cacheHit,
  };
};
