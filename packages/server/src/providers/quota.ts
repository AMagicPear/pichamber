import type { AgentSession, ModelInfo } from "@earendil-works/pi-coding-agent";
import type { ProviderDescriptor, ProviderQuota, QuotaWindow } from "@amagicpear/pichamber-shared";
import { toMessage } from "../error";
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
  currency?: string;
  parse: (payload: unknown, currency?: string) => QuotaWindow[];
  auth?:
    | { kind: "bearer" }
    /** The adapter owns authentication and does not use Pi's provider key. */
    | { kind: "self-managed"; fetch: () => Promise<unknown> };
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
  cacheScope: string,
): Promise<ProviderQuota> => {
  const now = nowMs();
  const cacheKey = `${cacheScope}\0${providerId}\0${baseUrl}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;

  try {
    const payload = adapter.auth?.kind === "self-managed"
      ? await adapter.auth.fetch()
      : await fetchBearer(adapter, baseUrl, apiKey);
    const result: ProviderQuota = {
      provider: providerId,
      windows: adapter.parse(payload, adapter.currency),
      fetchedAt: now,
    };
    cache.set(cacheKey, { expiresAt: now + MINUTE_MS, result });
    return result;
  } catch (error) {
    const result: ProviderQuota = { provider: providerId, error: toMessage(error), fetchedAt: now };
    cache.set(cacheKey, { expiresAt: now + MINUTE_MS, result });
    return result;
  }
};

const fetchBearer = async (adapter: QuotaAdapter, baseUrl: string, apiKey: string): Promise<unknown> => {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${adapter.path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, ...adapter.headers },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.json();
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

const parseBalance = (
  payload: unknown,
  opts: { currencyKey?: string; balanceKey?: string; label?: string; currency?: string } = {},
): QuotaWindow[] => {
  const root = payload as {
    is_available?: boolean;
    currency?: string;
    balance?: string;
    balance_infos?: Array<{ currency?: string; total_balance?: string; balance?: string }>;
    data?: { available_balance?: string; voucher_balance?: string; cash_balance?: string; currency?: string };
  };
  if (root.is_available === false) throw new Error("Account not available");

  const currency =
    opts.currency ??
    (opts.currencyKey
      ? ((root as Record<string, unknown>)[opts.currencyKey] as string | undefined)
      : (root.currency ?? root.data?.currency ?? root.balance_infos?.[0]?.currency));
  const balance = opts.balanceKey
    ? ((root as Record<string, unknown>)[opts.balanceKey] as string | undefined)
    : (root.balance ?? root.data?.available_balance ?? root.balance_infos?.[0]?.total_balance ??
        root.balance_infos?.[0]?.balance);

  const total = Number(balance);
  if (!Number.isFinite(total)) throw new Error("Balance unparseable");

  return [
    {
      label: opts.label ?? `Balance (${currency ?? "USD"})`,
      utilization: 0,
      resetsAt: 0,
      display: total.toFixed(2),
      limit: total,
      unit: currency,
    },
  ];
};

const parseDeepSeek = (payload: unknown): QuotaWindow[] => parseBalance(payload, { label: "Balance" });

const parseMoonshot = (payload: unknown, currency = "USD"): QuotaWindow[] =>
  parseBalance(payload, { label: "Balance", currency });

// ─── Volcengine Ark Agent Plan (HMAC-SHA256 signed) ──────────────────
//
// 火山方舟管控面 API 使用火山引擎签名算法（AWS SigV4 的火山变体）。
// GetAFPUsage 返回 5h / Weekly / Monthly 三个 AFP 额度窗口（AFPDaily 被
// 控制台隐藏，跳过）。
//
// 两处与标准 SigV4 的致命差异（照 cc-switch / 官方 java demo）：
//   1. canonical headers 与 SignedHeaders 用固定顺序
//      `host;x-date;x-content-sha256;content-type`（不按字母序）；
//   2. algorithm 串 `HMAC-SHA256`（无 AWS4 前缀）、credential scope 结尾
//      `request`、签名密钥 kDate=HMAC(SK, date)（SK 不加 AWS4 前缀）。
// canonical query 仍按 key 字母序；service=`ark`、POST、空 body。
//
// AK/SK 通过环境变量 VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY 提供。
// 个人版套餐的推理 API Key（Bearer Token）无法调用管控面接口。

const VOLC_SERVICE = "ark";
const VOLC_REGION = "cn-beijing";
const VOLC_HOST = "open.volcengineapi.com";
const VOLC_VERSION = "2024-01-01";
const VOLC_CONTENT_TYPE = "application/json; charset=utf-8";
const VOLC_SIGNED_HEADERS = "host;x-date;x-content-sha256;content-type";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

const sha256 = async (data: string | Uint8Array): Promise<string> => {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf.buffer as ArrayBuffer));
  return hex(digest);
};

const hmacSha256 = async (key: Uint8Array, data: string): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
};

const volcUriEncode = (input: string): string =>
  encodeURIComponent(input)
    .replace(/%7E/g, "~")
    .replace(/%2F/g, "/")
    .replace(/%3A/g, ":")
    .replace(/%2C/g, ",")
    .replace(/%5B/g, "[")
    .replace(/%5D/g, "]");

/** 构造按 key 字母序排序的 canonical query string（同签名与 URL）。 */
const volcCanonicalQuery = (action: string, region: string): string => {
  const pairs = [
    ["Action", action],
    ["Region", region],
    ["Version", VOLC_VERSION],
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${volcUriEncode(k)}=${volcUriEncode(v)}`).join("&");
};

/** Volcengine HMAC-SHA256 signature (SigV4 variant). */
const volcSign = async (opts: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  canonicalQuery: string;
  body: string;
  date: Date;
}): Promise<{ authorization: string; xDate: string; xContentSha256: string }> => {
  const { accessKeyId, secretAccessKey, region, canonicalQuery, body, date } = opts;

  const pad = (n: number) => n.toString().padStart(2, "0");
  const shortDate = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const xDate = `${shortDate}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

  const payloadHash = await sha256(body);

  // 火山特有固定顺序（不按字母序）。
  const canonicalHeaders =
    `host:${VOLC_HOST}\n` +
    `x-date:${xDate}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `content-type:${VOLC_CONTENT_TYPE}\n`;

  const canonicalRequest = [
    "POST",
    "/",
    canonicalQuery,
    canonicalHeaders,
    VOLC_SIGNED_HEADERS,
    payloadHash,
  ].join("\n");

  const credentialScope = `${shortDate}/${region}/${VOLC_SERVICE}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(secretAccessKey), shortDate);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, VOLC_SERVICE);
  const kSigning = await hmacSha256(kService, "request");
  const signature = hex(await hmacSha256(kSigning, stringToSign));

  const authorization =
    `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${VOLC_SIGNED_HEADERS}, Signature=${signature}`;

  return { authorization, xDate, xContentSha256: payloadHash };
};

const fetchVolcengine = async (
  action: string,
): Promise<unknown> => {
  const accessKeyId = process.env.VOLC_ACCESS_KEY_ID;
  const secretAccessKey = process.env.VOLC_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Volcengine AK/SK not configured (set VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY)");
  }

  const region = VOLC_REGION;
  const canonicalQuery = volcCanonicalQuery(action, region);

  const { authorization, xDate, xContentSha256 } = await volcSign({
    accessKeyId,
    secretAccessKey,
    region,
    canonicalQuery,
    body: "",
    date: new Date(),
  });

  const response = await fetch(`https://${VOLC_HOST}/?${canonicalQuery}`, {
    method: "POST",
    headers: {
      "Content-Type": VOLC_CONTENT_TYPE,
      "X-Date": xDate,
      "X-Content-Sha256": xContentSha256,
      Authorization: authorization,
    },
    body: "",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as { ResponseMetadata?: { Error?: { Code?: string; Message?: string } }; Result?: unknown };
  if (data.ResponseMetadata?.Error) {
    throw new Error(`${data.ResponseMetadata.Error.Code ?? "VolcengineError"}: ${data.ResponseMetadata.Error.Message ?? "unknown error"}`);
  }
  return data.Result ?? {};
};

const parseArkAfpUsage = (payload: unknown): QuotaWindow[] => {
  const root = payload as {
    PlanType?: string;
    AFPFiveHour?: { Quota?: number; Used?: number; ResetTime?: number };
    AFPWeekly?: { Quota?: number; Used?: number; ResetTime?: number };
    AFPMonthly?: { Quota?: number; Used?: number; ResetTime?: number };
  };

  const window = (
    label: string,
    data: { Quota?: number; Used?: number; ResetTime?: number } | undefined,
  ): QuotaWindow | undefined => {
    if (!data) return undefined;
    const quota = Number(data.Quota);
    const used = Number(data.Used);
    const resetsAt = Number(data.ResetTime);
    if (!Number.isFinite(quota) || !Number.isFinite(used) || quota <= 0) return undefined;
    return {
      label,
      utilization: clamp01(used / quota),
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : 0,
      used,
      limit: quota,
      unit: "AFP",
    };
  };

  const windows: QuotaWindow[] = [];
  const fiveHour = window("5h", root.AFPFiveHour);
  if (fiveHour) windows.push(fiveHour);
  const weekly = window("Weekly", root.AFPWeekly);
  if (weekly) windows.push(weekly);
  const monthly = window("Monthly", root.AFPMonthly);
  if (monthly) windows.push(monthly);

  if (windows.length === 0) throw new Error("GetAFPUsage response has no window data");
  return windows;
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
  const unit = root.unit === "USD" ? "USD" : undefined;

  return [
    {
      label: "Weekly",
      utilization: limit > 0 ? clamp01(used / limit) : 0,
      resetsAt,
      used,
      limit,
      unit,
    },
  ];
};

const adapters: QuotaAdapter[] = [
  {
    name: "Ark Agent Plan",
    providerIds: ["ark-agent-plan"],
    path: "/",
    parse: parseArkAfpUsage,
    auth: { kind: "self-managed", fetch: () => fetchVolcengine("GetAFPUsage") },
  },
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
    name: "Moonshot",
    providerIds: ["moonshotai-cn"],
    baseUrl: () => process.env.PICHAMBER_MOONSHOT_CN_BASE ?? "https://api.moonshot.cn/v1",
    path: "/users/me/balance",
    currency: "CNY",
    parse: parseMoonshot,
  },
  {
    name: "Moonshot",
    providerIds: ["moonshotai", "moonshot-ai", "moonshot"],
    baseUrl: () => process.env.PICHAMBER_MOONSHOT_BASE ?? "https://api.moonshot.ai/v1",
    path: "/users/me/balance",
    currency: "USD",
    parse: parseMoonshot,
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
  cacheScope = "global",
): Promise<ProviderQuota> => {
  const adapter = matchAdapter(providerId, apiType);
  if (!adapter) {
    return Promise.resolve({
      provider: providerId,
      error: `No quota adapter matches ${providerId}`,
      fetchedAt: nowMs(),
    });
  }
  if (!apiKey && adapter.auth?.kind !== "self-managed") return Promise.resolve(noApiKey(providerId));
  const resolvedBaseUrl =
    typeof adapter.baseUrl === "function"
      ? adapter.baseUrl()
      : (adapter.baseUrl ?? baseUrl);
  if (!resolvedBaseUrl && adapter.auth?.kind !== "self-managed") {
    return Promise.resolve({
      provider: providerId,
      error: `Provider ${providerId} has no baseUrl`,
      fetchedAt: nowMs(),
    });
  }
  return fetchQuota(adapter, providerId, resolvedBaseUrl ?? "", apiKey ?? "", cacheScope);
};

export const getProviderQuota = (providerId: string, session: AgentSession): Promise<ProviderQuota> => {
  return (async () => {
    const apiType = providerApiType(session, providerId);
    const adapter = matchAdapter(providerId, apiType);
    // Self-managed adapters (Volcengine HMAC) don't use the provider's
    // inference key, so resolving it must not block quota retrieval.
    const apiKey = adapter?.auth?.kind === "self-managed"
      ? ""
      : (await session.modelRuntime.getAuth(providerId))?.auth.apiKey;
    return getProviderQuotaWithApiKey(
      providerId,
      apiKey,
      apiType,
      providerBaseUrl(session, providerId),
      session.sessionId,
    );
  })();
};

export const clearQuotaCache = () => cache.clear();

// ─── Test helpers (exported for unit tests only) ──────────────────────
export { parseArkAfpUsage };
