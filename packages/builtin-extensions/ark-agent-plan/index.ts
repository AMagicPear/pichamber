/**
 * Ark Agent Plan — pichamber 内置扩展。
 *
 * 把「火山方舟 Agent Plan」注册为 Pi 的一个 provider（id: ark-agent-plan）。
 * Agent Plan 是火山方舟的个人版订阅套餐：用一张推理 API Key（Bearer token）
 * 走 anthropic-messages 协议访问一组模型，额度按 AFP 窗口统计。
 *
 * 这个扩展自包含、无第三方运行时依赖（只 import 类型 + WebCrypto/fetch），
 * 因此同时适用于：
 *   • pichamber Settings → Extensions 手动 Configure 后
 *   • 在任意地方直接运行 `pi` 时（自动发现加载）
 *
 * 模型列表通过管控面 API `ListArkAgentPlanModel` 动态拉取（HMAC-SHA256 签名，
 * AK/SK 来自环境变量 VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY）。拉取失败
 * 或无 AK/SK 时回退到内置静态表，保证推理 key 单独可用。
 */
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

// ─── Provider 常量 ────────────────────────────────────────────────────

const PROVIDER_ID = "ark-agent-plan";
const PROVIDER_NAME = "Ark Agent Plan";
const INFERENCE_BASE = "https://ark.cn-beijing.volces.com/api/plan";
const API = "anthropic-messages" as const;
const INFERENCE_KEY_ENV = "ARK_AGENT_PLAN_KEY";

// ─── 火山管控面（OpenAPI）常量 ────────────────────────────────────────

const VOLC_HOST = "open.volcengineapi.com";
const VOLC_REGION = "cn-beijing";
const VOLC_SERVICE = "ark";
const VOLC_VERSION = "2024-01-01";
const VOLC_CONTENT_TYPE = "application/json; charset=utf-8";
const VOLC_SIGNED_HEADERS = "host;x-date;x-content-sha256;content-type";

// ─── HMAC-SHA256 签名（火山 SigV4 变体，同 GetAFPUsage）────────────────

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const sha256 = async (data: string | Uint8Array): Promise<string> => {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buf.buffer as ArrayBuffer);
  return toHex(new Uint8Array(digest));
};

const hmacSha256 = async (key: Uint8Array, data: string): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)));
};

/** 为给定 Action 构造 HMAC-SHA256 签名并调用管控面 API。返回 Result 对象。 */
const volcOpenApi = async (action: string): Promise<Record<string, unknown>> => {
  const accessKeyId = process.env.VOLC_ACCESS_KEY_ID;
  const secretAccessKey = process.env.VOLC_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY not set");
  }

  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const shortDate = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const xDate = `${shortDate}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

  // 固定顺序 canonical headers（火山特有，不按字母序）。
  const query = `Action=${action}&Region=${VOLC_REGION}&Version=${VOLC_VERSION}`;
  const payloadHash = await sha256("");
  const canonicalHeaders =
    `host:${VOLC_HOST}\n` +
    `x-date:${xDate}\n` +
    `x-content-sha256:${payloadHash}\n` +
    `content-type:${VOLC_CONTENT_TYPE}\n`;
  const canonicalRequest = ["POST", "/", query, canonicalHeaders, VOLC_SIGNED_HEADERS, payloadHash].join("\n");
  const scope = `${shortDate}/${VOLC_REGION}/${VOLC_SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, scope, await sha256(canonicalRequest)].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(secretAccessKey), shortDate);
  const kRegion = await hmacSha256(kDate, VOLC_REGION);
  const kService = await hmacSha256(kRegion, VOLC_SERVICE);
  const kSigning = await hmacSha256(kService, "request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  const authorization =
    `HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${VOLC_SIGNED_HEADERS}, Signature=${signature}`;

  const response = await fetch(`https://${VOLC_HOST}/?${query}`, {
    method: "POST",
    headers: {
      "Content-Type": VOLC_CONTENT_TYPE,
      "X-Date": xDate,
      "X-Content-Sha256": payloadHash,
      Authorization: authorization,
    },
    body: "",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { Result?: unknown };
  return (data.Result as Record<string, unknown>) ?? {};
};

// ─── 模型元数据 ────────────────────────────────────────────────────────

/** ListArkAgentPlanModel 只返回 ModelID，无上下文/推理等元数据。动态拉到的
 *  模型统一用保守默认值（列表由 Agent Plan 订阅覆盖，无需精确 cost）。 */
const DEFAULT_MODEL_META = {
  reasoning: true,
  input: ["text", "image"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 262144,
  maxTokens: 32768,
};

const toModel = (id: string) => ({
  id,
  name: id,
  ...DEFAULT_MODEL_META,
});

/** 推理 key 单独可用时的静态回退表（ListArkAgentPlanModel 拉取失败时用）。
 *  与动态列表一致：只保证推理 key 能选到模型。 */
const FALLBACK_MODELS = [
  "doubao-seed-2.0-mini",
  "doubao-seed-2.0-lite",
  "doubao-seed-2-1-turbo",
  "doubao-seed-evolving",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5.2",
  "glm-5.3",
  "minimax-m3",
  "kimi-k2.7-code",
  "kimi-k3",
].map(toModel);

/** 拉取 Agent Plan 支持的模型列表；失败时回退静态表（静默降级）。 */
const fetchAgentPlanModels = async (): Promise<ReturnType<typeof toModel>[]> => {
  try {
    const result = await volcOpenApi("ListArkAgentPlanModel");
    const datas = (result.Datas as Array<{ ModelID?: string }> | undefined) ?? [];
    const ids = datas
      .map((entry) => entry.ModelID)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return FALLBACK_MODELS;
    return ids.map(toModel);
  } catch {
    return FALLBACK_MODELS;
  }
};

// ─── Provider 注册 ─────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI): Promise<void> {
  const config: ProviderConfig = {
    name: PROVIDER_NAME,
    baseUrl: INFERENCE_BASE,
    apiKey: `\${${INFERENCE_KEY_ENV}}`,
    api: API,
    headers: { Authorization: `Bearer \${${INFERENCE_KEY_ENV}}` },
    // Load once while Pi initializes the extension. This gives every new
    // session a complete catalog before pichamber snapshots available models;
    // fetchAgentPlanModels falls back locally when AK/SK is unavailable.
    models: await fetchAgentPlanModels(),
    refreshModels: async () => fetchAgentPlanModels(),
  };
  pi.registerProvider(PROVIDER_ID, config);
}
