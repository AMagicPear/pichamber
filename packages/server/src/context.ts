import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { getLastAssistantUsage } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { LastAssistantUsage, ModelDescriptor, SessionStatsView } from "@pichamber/shared";
import { providerName } from "./providers";

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

/** Pull a Model<Api> down to the slim ModelDescriptor the wire ships. */
const modelDescriptor = (model: Model<Api> | undefined, session: AgentSession): ModelDescriptor | undefined => {
  if (!model) return undefined;
  return {
    provider: model.provider,
    providerName: providerName(session, model.provider),
    id: model.id,
    name: model.name || model.id,
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

/** Build the ready-to-render stats view. All display strings (date,
 *  percent, cost, cache hit, comma-grouped tokens) are produced here per
 *  the project's "server computes display strings" rule. The `cost.raw`
 *  field is included so a future sortable cost column wouldn't need a
 *  second pass over the session. */
export const computeSessionStatsView = (session: AgentSession): SessionStatsView => {
  const stats = session.getSessionStats();
  const branch = session.sessionManager.getBranch();
  const lastUsage = getLastAssistantUsage(branch);
  const lastAssistant: LastAssistantUsage = lastUsage
    ? {
        input: lastUsage.input ?? 0,
        output: lastUsage.output ?? 0,
        reasoning: lastUsage.reasoning ?? 0,
        cacheRead: lastUsage.cacheRead ?? 0,
        cacheWrite: lastUsage.cacheWrite ?? 0,
      }
    : emptyUsage();

  // Modified = timestamp of the latest entry on the active branch. Mirrors
  // how `SessionInfo.modified` is computed in pi's session-manager.
  let modifiedDate: Date | null = null;
  for (let i = branch.length - 1; i >= 0; i--) {
    const ts = branch[i]?.timestamp;
    if (typeof ts === "string") {
      const ms = new Date(ts).getTime();
      if (!Number.isNaN(ms)) {
        modifiedDate = new Date(ms);
        break;
      }
    }
  }

  const totalRead = stats.tokens.cacheRead + stats.tokens.input;
  const cacheHit = totalRead > 0 ? formatPercent(stats.tokens.cacheRead / totalRead) : "0.0%";

  return {
    model: modelDescriptor(session.model, session),
    modified: modifiedDate ? dateFormat.format(modifiedDate) : "",
    context: {
      tokens: stats.contextUsage?.tokens ?? null,
      contextWindow: stats.contextUsage?.contextWindow ?? 0,
      percent: stats.contextUsage?.percent != null ? formatPercent(stats.contextUsage.percent / 100) : null,
      tokensText:
        stats.contextUsage?.tokens != null ? numberFormat.format(stats.contextUsage.tokens) : "—",
    },
    messages: {
      total: stats.totalMessages,
      user: stats.userMessages,
      assistant: stats.assistantMessages,
    },
    cost: { value: formatCost(stats.cost), raw: stats.cost },
    lastAssistant,
    cacheHit,
  };
};
