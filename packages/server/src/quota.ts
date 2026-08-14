import type { AgentSession } from "@earendil-works/pi-coding-agent";
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

type QuotaAdapter = {
  /** Human label used when the provider name is unavailable. */
  name: string;
  /** Exact Pi provider ids this adapter serves (well-known providers). */
  providerIds?: string[];
  /** Fallback: model `api` types this adapter can handle generically. */
  apiTypes?: string[];
  /** Endpoint path on the provider's baseUrl. */
  path: string;
  /** Optional host override — used when the quota endpoint lives on a
   *  different host than the chat API (e.g. MiniMax's chat API is
   *  `/anthropic`-scoped but its token-plan endpoint is on the bare host). */
  baseUrl?: string | (() => string);
  /** Extra headers beyond `Authorization: Bearer`. */
  headers?: Record<string, string>;
  /** Extract windows from the upstream JSON. Throws → `{ error }` quota. */
  parse: (payload: unknown) => QuotaWindow[];
};

/** Match a provider to an adapter. Specific adapters take priority over
 *  api-type fallbacks. */
const matchAdapter = (providerId: string, apiType: string | undefined): QuotaAdapter | undefined => {
  const specific = adapters.find((adapter) => adapter.providerIds?.includes(providerId));
  if (specific) return specific;
  if (apiType) {
    return adapters.find((adapter) => !adapter.providerIds && adapter.apiTypes?.includes(apiType));
  }
  return undefined;
};

// ─── Parsers ────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const nowMs = Date.now;
const MINUTE_MS = 60_000;

/** Shared cache: providers are rate-limited upstream and the UI doesn't
 *  need sub-minute freshness. */
const cache = new Map<string, { expiresAt: number; result: ProviderQuota }>();

/** Shared executor: resolve the key, call the endpoint, parse, cache.
 *  Every adapter goes through this so none re-implement the request/error/
 *  TTL dance. */
const fetchQuota = async (
  adapter: QuotaAdapter,
  providerId: string,
  baseUrl: string,
  session: AgentSession,
): Promise<ProviderQuota> => {
  const now = nowMs();
  const cached = cache.get(providerId);
  if (cached && cached.expiresAt > now) return cached.result;

  const apiKey = (await session.modelRuntime.getAuth(providerId))?.auth.apiKey;
  if (!apiKey) {
    const result: ProviderQuota = { provider: providerId, error: `No API key configured for ${providerId}`, fetchedAt: now };
    cache.set(providerId, { expiresAt: now + MINUTE_MS, result });
    return result;
  }

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

// ─── MiniMax ────────────────────────────────────────────────────────────

/** MiniMax Token Plan: `remaining_percent` per window (utilization =
 *  100 − remaining) and absolute `*_time` ms timestamps. Chat models live
 *  under the `general` bucket. */
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

// ─── DeepSeek ───────────────────────────────────────────────────────────

/** DeepSeek is pay-as-you-go: a plain balance, no rolling window. One
 *  window with `display` (no bar) so the panel shows the amount. */
const parseDeepSeek = (payload: unknown): QuotaWindow[] => {
  const root = payload as { is_available?: boolean; balance_infos?: Array<{ currency?: string; total_balance?: string }> };
  if (root.is_available === false) throw new Error("DeepSeek account not available");
  const primary = (Array.isArray(root.balance_infos) ? root.balance_infos : [])[0];
  if (!primary) throw new Error("DeepSeek balance response empty");

  const total = Number(primary.total_balance);
  if (!Number.isFinite(total)) throw new Error("DeepSeek balance unparseable");

  return [{ label: `Balance (${primary.currency ?? "USD"})`, utilization: 0, resetsAt: 0, display: total.toFixed(2) }];
};

// ─── OpenAI-compatible subscription (generic fallback) ──────────────────

/** Many OpenAI-compatible gateways expose a subscription/usage endpoint
 *  shaped like OpenAI's `/v1/usage` — a USD cap + usage snapshot. This is
 *  the generic adapter that lets arbitrary proxies (which we never name in
 *  code) surface their quota automatically. */
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

// ─── Adapter registry ───────────────────────────────────────────────────

/** Ordered registry. Specific adapters (with `providerIds`) are matched
 *  first; the api-type fallback adapter is last so it only picks up
 *  providers none of the specific ones claimed. */
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
    path: "/user/balance",
    parse: parseDeepSeek,
  },
  // Generic fallback: any OpenAI-compatible provider (self-hosted proxies,
  // private gateways like a personal SUDA-MKT deployment) that supports the
  // /usage endpoint. Matched by model `api` type, not by name.
  {
    name: "OpenAI-compatible",
    apiTypes: ["openai-completions", "openai-responses"],
    path: "/usage",
    parse: parseOpenAiUsage,
  },
];

/** Provider id → adapter (resolved lazily). */
const adapterFor = (session: AgentSession, providerId: string): QuotaAdapter | undefined =>
  matchAdapter(providerId, providerApiType(session, providerId));

export const listQuotaProviders = (session: AgentSession): ProviderDescriptor[] =>
  session.modelRuntime
    .getProviders()
    .filter(
      (provider) =>
        matchAdapter(provider.id, providerApiType(session, provider.id)) !== undefined &&
        session.modelRuntime.hasConfiguredAuth(provider.id),
    )
    .map((provider) => ({ id: provider.id, name: providerName(session, provider.id) }));

export const getProviderQuota = (providerId: string, session: AgentSession): Promise<ProviderQuota> => {
  const adapter = adapterFor(session, providerId);
  if (!adapter) {
    return Promise.resolve({
      provider: providerId,
      error: `No quota adapter matches ${providerId}`,
      fetchedAt: nowMs(),
    });
  }
  const baseUrl =
    typeof adapter.baseUrl === "function"
      ? adapter.baseUrl()
      : (adapter.baseUrl ?? providerBaseUrl(session, providerId));
  if (!baseUrl) {
    return Promise.resolve({
      provider: providerId,
      error: `Provider ${providerId} has no baseUrl`,
      fetchedAt: nowMs(),
    });
  }
  return fetchQuota(adapter, providerId, baseUrl, session);
};

/** Drop cached entries (used by tests / when auth changes). */
export const clearQuotaCache = () => cache.clear();
