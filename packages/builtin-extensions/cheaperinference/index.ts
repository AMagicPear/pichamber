/**
 * Cheaper Inference — pichamber 内置扩展。
 *
 * 把 Cheaper Inference 注册为 Pi 的一个 first-class provider（id: cheaperinference）。
 * Cheaper Inference (https://cheaperinference.com) 是一个 OpenAI-compatible LLM
 * gateway：用一张 API key（Bearer）在 `https://api.cheaperinference.com/v1` 上
 * 调用多家模型，模型 ID 不带 vendor 前缀（如 `gpt-5.4-mini`）。
 *
 * 这个扩展自包含、无第三方运行时依赖（只 import 类型 + fetch），因此同时适用于：
 *   • pichamber Settings → Extensions 手动 Configure 后（复制到
 *     `~/.pi/agent/extensions/pichamber-cheaperinference/`）
 *   • 在任意地方直接运行 `pi` 时（Pi 自动发现加载）
 *
 * 模型列表的唯一事实源是网关的公开目录 `GET /public/models`。目录里混有
 * image / video / embedding / speech 等专用 endpoint 的条目，这里只保留
 * `model_type: "text"` 且支持 `/v1/chat/completions` 的模型，因为 Pi 走的是
 * `openai-completions`。模型目录通过 Pi 的 `refreshModels` 路径显式刷新；
 * 目录请求失败或过滤后为空时显式报错，不用手写模型静默降级。
 */
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

// ─── Provider 常量 ────────────────────────────────────────────────────

export const CHEAPER_INFERENCE_PROVIDER_ID = "cheaperinference";
export const CHEAPER_INFERENCE_PROVIDER_NAME = "Cheaper Inference";
export const CHEAPER_INFERENCE_BASE_URL = "https://api.cheaperinference.com/v1";
export const CHEAPER_INFERENCE_API_KEY_ENV = "CHEAPER_INFERENCE_API_KEY";
const CHAT_ENDPOINT = "/v1/chat/completions";

// ─── Cheaper Inference 目录 API 类型（本扩展自包含所需的最小字段）──────────

type CheaperInferenceCatalogEntry = {
  id: string;
  model_type?: string;
  endpoint?: string;
  supported_endpoints?: string[] | null;
  context_length?: number | null;
  max_output_tokens?: number | null;
  supports_vision?: boolean;
  supports_reasoning?: boolean;
  input_per_million?: string | number | null;
  output_per_million?: string | number | null;
  cache_read_per_million?: string | number | null;
  cache_write_per_million?: string | number | null;
};
export type { CheaperInferenceCatalogEntry };

type CheaperInferenceCatalogResponse = { models?: CheaperInferenceCatalogEntry[] };

// ─── chat 可调用判定 ─────────────────────────────────────────────────────
//
// 只有 text 模型且声明支持 chat completions 的条目才能被 Pi 驱动；
// 只走 /v1/responses 的模型（如 *-pro）与各类专用 endpoint 一律排除。
export const isChatModel = (entry: CheaperInferenceCatalogEntry): boolean =>
  entry.model_type === "text" &&
  (entry.supported_endpoints ?? (entry.endpoint ? [entry.endpoint] : [])).includes(CHAT_ENDPOINT);

// 图片输入必须由目录显式声明（supports_vision），未声明的 fail closed 为 text-only。
export const toModelInput = (entry: CheaperInferenceCatalogEntry): ("text" | "image")[] =>
  entry.supports_vision === true ? ["text", "image"] : ["text"];

const toNumber = (value: string | number | null | undefined): number | undefined => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

// ─── 模型元数据 ────────────────────────────────────────────────────────

/** Pi 需要每个模型提供 cost / contextWindow / maxTokens。目录里没有的字段
 *  用保守默认值；cost 未知时填 0（Pi 只拿它做用量统计展示）。 */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const FALLBACK_MAX_TOKENS = 32_768;

export const toPiModel = (entry: CheaperInferenceCatalogEntry) => {
  const contextWindow = entry.context_length ?? DEFAULT_CONTEXT_WINDOW;
  const maxTokens = Math.min(entry.max_output_tokens ?? FALLBACK_MAX_TOKENS, contextWindow);
  return {
    id: entry.id,
    name: entry.id,
    reasoning: entry.supports_reasoning === true,
    input: toModelInput(entry),
    cost: {
      input: toNumber(entry.input_per_million) ?? 0,
      output: toNumber(entry.output_per_million) ?? 0,
      cacheRead: toNumber(entry.cache_read_per_million) ?? 0,
      cacheWrite: toNumber(entry.cache_write_per_million) ?? 0,
    },
    contextWindow,
    maxTokens,
  };
};

// ─── 实时模型目录 ───────────────────────────────────────────────────────

/** 把 `/public/models` 的真实响应转成 Pi 模型清单。独立成纯函数便于测试。 */
export const toPiModelsFromCatalog = (entries: CheaperInferenceCatalogEntry[]): ReturnType<typeof toPiModel>[] =>
  entries.filter(isChatModel).map(toPiModel);

/** fetch 的最小结构签名（便于测试注入；生产用全局 fetch）。 */
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** 拉取公开目录并转成 Pi 模型。目录不需要 key；失败与空目录都显式抛错，
 *  让设置页展示 network/empty 状态并由用户重试；只有真实 API 响应可进入缓存。
 *  `fetchFn` 仅用于测试注入。 */
export const fetchCheaperInferenceChatModels = async (
  fetchFn: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<ReturnType<typeof toPiModel>[]> => {
  const url = new URL("/public/models", CHEAPER_INFERENCE_BASE_URL);
  const response = await fetchFn(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`Cheaper Inference model catalog returned HTTP ${response.status}`);
  const payload = (await response.json()) as CheaperInferenceCatalogResponse;
  const models = toPiModelsFromCatalog(payload.models ?? []);
  if (models.length === 0) throw new Error("Cheaper Inference returned an empty chat model catalog");
  return models;
};

// ─── Provider 注册 ─────────────────────────────────────────────────────

const registerCheaperInference = async (pi: ExtensionAPI) => {
  const config: ProviderConfig = {
    name: CHEAPER_INFERENCE_PROVIDER_NAME,
    baseUrl: CHEAPER_INFERENCE_BASE_URL,
    // 环境变量插值（与 orcarouter 一致）：请求时 Pi 先解析
    // CHEAPER_INFERENCE_API_KEY；用户在 Settings 里填过 key（存入 auth.json）后，
    // 存储的 credential 优先。key 始终留在服务端进程里，浏览器不持有。
    apiKey: `\${${CHEAPER_INFERENCE_API_KEY_ENV}}`,
    api: "openai-completions",
    models: [],
    refreshModels: ({ signal }) => fetchCheaperInferenceChatModels(fetch, signal),
  };
  pi.registerProvider(CHEAPER_INFERENCE_PROVIDER_ID, config);
};

export default registerCheaperInference;
