import type { AgentSession, ModelInfo } from "@earendil-works/pi-coding-agent";
import type { ProviderDescriptor, ProviderQuota, QuotaWindow } from "@pichamber/shared";
import { toMessage } from "./error";
import { providerApiType, providerBaseUrl, providerName } from "./providers";

// ─── Quota adapter model ───────────────────────────────────────────────
//
// A provider's quota endpoint and response shape differ wildly between
// services. Instead of hard-coding specific providers, we model each quota
// source as an *adapter* with two matching strategies:
//
//   1. `providerIds`  — exact match on the Pi provider id. Used for the
//      well-known providers (OpenAI, Anthropic, DeepSeek, MiniMax).
//   2. `apiTypes`     — fallback match on the provider's model `api` type
//      (openai-completions, openai-responses, …). This adapts to arbitrary
//      self-hosted / proxy providers (e.g. a private OpenAI-compatible
//      gateway) without ever naming them in code.
//
// Resolution order: a provider matching a specific adapter wins; otherwise
// the first api-type adapter whose `apiTypes` includes the provider's model
// api is used. Providers matched by neither are unsupported.
//
// SDK runtimes provide the full registry, including generic provider API
// metadata. RPC runtimes expose configured model providers only, so their
// quota surface is limited to adapters that can be selected by provider id.

type QuotaAdapter = {
  name: string;
  providerIds?: string[];
  apiTypes?: string[];
  path: string;
  baseUrl?: string | (() => string);
  headers?: Record<string, string>;
  parse: (payload: unknown) => QuotaWindow[];
};

const matchAdapter = (providerId: string, apiType: string | undefined): QuotaAdapter | undefined => {
  const specific = adapters.find((adapter) => adapter.providerIds?.includes(providerId));
  if (specific) return specific;
  if (apiType) {
    return adapters.find((adapter) => !adapter.providerIds && adapter.apiTypes?.includes(apiType));
  }
  return undefined;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const nowMs = Date.now;
const MINUTE_MS = 60_000;

const cache = new Map<string, { expiresAt: number; result: ProviderQuota }>();

const fetchQuota = async (
  adapter: QuotaAdapter,
  providerId: string,
  baseUrl: string,
  apiKey: string,
): Promise<ProviderQuota> => {
  const now = nowMs();
  const cached = cache.get(providerId);
  if (cached && cached.expiresAt > now) return cached.result;

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${adapter.path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, ...adapter.headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const payload = (await response.json()) as unknown;
    const result: ProviderQuota = { provider: providerId, windows: adapter.parse(payload), fetchedAt: now };
    cache.set(providerId, { expiresAt: now + MINUTE_MS, result });
    return result;
  } catch (error) {
    const result: ProviderQuota = { provider: providerId, error: toMessage(error), fetchedAt: now };
    cache.set(providerId, { expiresAt: now + MINUTE_MS, result });
    return result;
  }
};

const noApiKey = (provider: string): ProviderQuota => ({
  provider,
  error: `No API key configured for ${provider}`,
  fetchedAt: nowMs(),
});

const parseMiniMax = (payload: unknown): QuotaWindow[] => {
  const root = payload as { model_remains?: unknown; base_resp?: { status_code?: number; status_msg?: string } };
  if (root.base_resp?.status_code !== 0) {
    throw new Error(`MiniMax quota error: ${root.base_resp?.status_msg ?? "unknown"}`);
  }
  const general = (Array.isArray(root.model_remains) ? root.model_remains : []).find(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && (entry as Record<string, unknown>).model_name === "general",
  );
  if (!general) throw new Error('MiniMax quota response missing "general" bucket');

  const remaining = Number(general.current_interval_remaining_percent);
  const endsAt = Number(general.end_time);
  if (!Number.isFinite(remaining) || !Number.isFinite(endsAt)) {
    throw new Error("MiniMax quota response missing required fields");
  }

  const windows: QuotaWindow[] = [
    { label: "5h", utilization: clamp01((100 - remaining) / 100), resetsAt: endsAt },
  ];

  const weeklyRemaining = Number(general.current_weekly_remaining_percent);
  const weeklyEndsAt = Number(general.weekly_end_time);
  if (Number.isFinite(weeklyRemaining) && Number.isFinite(weeklyEndsAt) && weeklyEndsAt > nowMs()) {
    windows.push({
      label: "Weekly",
      utilization: clamp01((100 - weeklyRemaining) / 100),
      resetsAt: weeklyEndsAt,
    });
  }
  return windows;
};

const parseDeepSeek = (payload: unknown): QuotaWindow[] => {
  const root = payload as { is_available?: boolean; balance_infos?: Array<{ currency?: string; total_balance?: string }> };
  if (root.is_available === false) throw new Error("DeepSeek account not available");
  const primary = (Array.isArray(root.balance_infos) ? root.balance_infos : [])[0];
  if (!primary) throw new Error("DeepSeek balance response empty");

  const total = Number(primary.total_balance);
  if (!Number.isFinite(total)) throw new Error("DeepSeek balance unparseable");

  return [{ label: `Balance (${primary.currency ?? "USD"})`, utilization: 0, resetsAt: 0, display: total.toFixed(2) }];
};

const parseOpenAiUsage = (payload: unknown): QuotaWindow[] => {
  const root = payload as {
    subscription?: {
      weekly_limit_usd?: number;
      weekly_usage_usd?: number;
      weekly_window_start?: string;
    };
    unit?: string;
  };
  const sub = root.subscription ?? {};
  const limit = Number(sub.weekly_limit_usd);
  const used = Number(sub.weekly_usage_usd);
  if (!Number.isFinite(limit) || !Number.isFinite(used)) {
    throw new Error("usage response missing weekly limit / usage");
  }

  const resetsAt = sub.weekly_window_start ? Date.parse(sub.weekly_window_start) + 7 * 86_400_000 : 0;
  const unit = root.unit === "USD" ? "USD" : "";

  return [
    {
      label: `Weekly${unit ? ` (${unit})` : ""}`,
      utilization: limit > 0 ? clamp01(used / limit) : 0,
      resetsAt,
    },
  ];
};

const adapters: QuotaAdapter[] = [
  {
    name: "MiniMax",
    providerIds: ["minimax-cn"],
    baseUrl: () => process.env.PICHAMBER_MINIMAX_BASE ?? "https://api.minimaxi.com",
    path: "/v1/token_plan/remains",
    headers: { "Content-Type": "application/json" },
    parse: parseMiniMax,
  },
  {
    name: "DeepSeek",
    providerIds: ["deepseek"],
    baseUrl: () => process.env.PICHAMBER_DEEPSEEK_BASE ?? "https://api.deepseek.com",
    path: "/user/balance",
    parse: parseDeepSeek,
  },
  {
    name: "OpenAI",
    providerIds: ["openai"],
    baseUrl: "https://api.openai.com/v1",
    path: "/usage",
    parse: parseOpenAiUsage,
  },
  {
    name: "OpenAI-compatible",
    apiTypes: ["openai-completions", "openai-responses"],
    path: "/usage",
    parse: parseOpenAiUsage,
  },
];

/** Quota requires the SDK's `modelRuntime` for auth + provider metadata.
 *  RPC runtimes don't expose either, so the quota surface degrades to
 *  an empty list. The HTTP layer short-circuits before calling these
 *  helpers for non-SDK sessions. */
export const listQuotaProviders = (session: AgentSession): ProviderDescriptor[] =>
  session.modelRuntime
    .getProviders()
    .filter(
      (provider) =>
        matchAdapter(provider.id, providerApiType(session, provider.id)) !== undefined &&
        session.modelRuntime.hasConfiguredAuth(provider.id),
    )
    .map((provider) => ({ id: provider.id, name: providerName(session, provider.id) }));

/** RPC only exposes configured models, not provider registry metadata. Limit
 * its quota menu to adapters we can identify from a provider id alone; generic
 * OpenAI-compatible proxies still require SDK-only base-url/API metadata. */
export const listQuotaProvidersForModels = (
  models: Iterable<Pick<ModelInfo, "provider">>,
): ProviderDescriptor[] => {
  const seen = new Set<string>();
  const providers: ProviderDescriptor[] = [];
  for (const model of models) {
    if (seen.has(model.provider)) continue;
    const adapter = matchAdapter(model.provider, undefined);
    if (!adapter) continue;
    seen.add(model.provider);
    providers.push({ id: model.provider, name: adapter.name });
  }
  return providers;
};

/** Query a supported quota endpoint with a credential resolved by the owning
 * runtime. RPC callers supply a key printed by their external Pi executable;
 * SDK callers retain their direct ModelRuntime path below. */
export const getProviderQuotaWithApiKey = (
  providerId: string,
  apiKey: string | undefined,
  apiType?: string,
  baseUrl?: string,
): Promise<ProviderQuota> => {
  const adapter = matchAdapter(providerId, apiType);
  if (!adapter) {
    return Promise.resolve({
      provider: providerId,
      error: `No quota adapter matches ${providerId}`,
      fetchedAt: nowMs(),
    });
  }
  if (!apiKey) return Promise.resolve(noApiKey(providerId));
  const resolvedBaseUrl =
    typeof adapter.baseUrl === "function"
      ? adapter.baseUrl()
      : (adapter.baseUrl ?? baseUrl);
  if (!resolvedBaseUrl) {
    return Promise.resolve({
      provider: providerId,
      error: `Provider ${providerId} has no baseUrl`,
      fetchedAt: nowMs(),
    });
  }
  return fetchQuota(adapter, providerId, resolvedBaseUrl, apiKey);
};

export const getProviderQuota = (providerId: string, session: AgentSession): Promise<ProviderQuota> => {
  return (async () => {
    const apiKey = (await session.modelRuntime.getAuth(providerId))?.auth.apiKey;
    return getProviderQuotaWithApiKey(
      providerId,
      apiKey,
      providerApiType(session, providerId),
      providerBaseUrl(session, providerId),
    );
  })();
};

export const clearQuotaCache = () => cache.clear();
