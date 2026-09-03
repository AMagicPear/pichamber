/**
 * OrcaRouter — pichamber 内置扩展。
 *
 * 把 OrcaRouter 注册为 Pi 的一个 first-class provider（id: orcarouter）。
 * OrcaRouter (https://www.orcarouter.ai) 是一个 OpenAI-compatible AI gateway：
 * 用一张 API key（Bearer）在同一个 `https://api.orcarouter.ai/v1` endpoint 上
 * 同时提供 models 与 agents 网关能力，模型 ID 保留 `vendor/model` 命名空间。
 *
 * 这个扩展自包含、无第三方运行时依赖（只 import 类型 + fetch），因此同时适用于：
 *   • pichamber Settings → Extensions 手动 Configure 后（复制到
 *     `~/.pi/agent/extensions/pichamber-orcarouter/`）
 *   • 在任意地方直接运行 `pi` 时（Pi 自动发现加载）
 *
 * 模型列表的唯一事实源是 OrcaRouter 目录 API `GET /v1/models?capability=chat`。
 * capability=chat 是网关对「文本 chat / agent」的权威过滤：只返回可被 chat
 * 路由驱动的模型（排除 TTS / embedding / image-generation / openai-video 等
 * 专用 endpoint 与未加命名空间的杂项模型）。扩展在 Pi 初始化时拉取一次
 * （离线/失败时用本地静态回退表保证依然可选到模型，回退表只含 OrcaRouter
 * 自家 gateway 模型），并提供 `refreshModels` 让目录可被刷新。可调用模型只取
 * 真实 API 返回的 id，绝不由自由文本拼装。
 */
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

// ─── Provider 常量 ────────────────────────────────────────────────────

export const ORCAROUTER_PROVIDER_ID = "orcarouter";
export const ORCAROUTER_PROVIDER_NAME = "OrcaRouter";
export const ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1";
export const ORCAROUTER_API_KEY_ENV = "ORCAROUTER_API_KEY";
/** 目录拉取超时（毫秒）。注册是 Pi 启动关键路径，不能无限等待。 */
const FETCH_TIMEOUT_MS = 8_000;

// ─── OrcaRouter 目录 API 类型（本扩展自包含所需的最小字段）───────────────

type OrcaModelCatalogEntry = {
  id: string;
  name?: string;
  context_length?: number;
  max_completion_tokens?: number;
  architecture?: { input_modalities?: string[] | null } | null;
  pricing?: {
    prompt_per_million?: string | number;
    completion_per_million?: string | number;
  } | null;
};
export type { OrcaModelCatalogEntry };

type OrcaModelCatalogResponse = { data?: OrcaModelCatalogEntry[] };

// ─── 多模态（image chat）判定 ───────────────────────────────────────────
//
// `?capability=chat` 已保证条目可被 chat 路由。这里只进一步区分「是否接受
// 图片输入」：目录必须显式声明 `architecture.input_modalities` 含 image。
// 未声明能力的模型 fail closed，当作 text-only —— 绝不把未知能力混入多模态。
export const declaresImageInput = (entry: OrcaModelCatalogEntry): boolean =>
  (entry.architecture?.input_modalities ?? []).some((modality) => modality.toLowerCase() === "image");

export const toModelInput = (entry: OrcaModelCatalogEntry): ("text" | "image")[] =>
  declaresImageInput(entry) ? ["text", "image"] : ["text"];

const toNumber = (value: string | number | undefined): number | undefined => {
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

export const toPiModel = (entry: OrcaModelCatalogEntry) => {
  const contextWindow = entry.context_length ?? DEFAULT_CONTEXT_WINDOW;
  const maxTokens = Math.min(entry.max_completion_tokens ?? FALLBACK_MAX_TOKENS, contextWindow);
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    reasoning: true,
    input: toModelInput(entry),
    cost: {
      input: toNumber(entry.pricing?.prompt_per_million) ?? 0,
      output: toNumber(entry.pricing?.completion_per_million) ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
  };
};

// ─── 静态回退表 ─────────────────────────────────────────────────────────
//
// 目录拉取失败、超时或 key 尚未配置时使用。只含 OrcaRouter 自家 gateway
// 模型（orcarouter/*），不冒充上游 vendor 模型。让用户在没有网络 / 还没
// 配 key 时也能先选到 OrcaRouter 入口。
const ORCAROUTER_FALLBACK_MODELS: ReturnType<typeof toPiModel>[] = [
  "orcarouter/free",
  "orcarouter/fusion-mini",
  "orcarouter/fusion-flash",
  "orcarouter/fusion",
].map((id) => toPiModel({ id, architecture: { input_modalities: ["text"] } }));

/** 把 `/v1/models` 的真实响应转成 Pi 模型清单。返回空数组时由调用方决定
 *  回退策略（fetchOrcaChatModels 回退静态表）。独立成纯函数便于测试。 */
export const toPiModelsFromCatalog = (entries: OrcaModelCatalogEntry[]): ReturnType<typeof toPiModel>[] =>
  entries.map(toPiModel);

/** fetch 的最小结构签名（便于测试注入；生产用全局 fetch）。 */
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** 拉取 chat 可调用目录并转成 Pi 模型；失败时回退静态表（静默降级）。
 *  真实响应的 data[] 直接决定模型清单；任何异常都不拼装自由文本。
 *  `fetchFn` 仅用于测试注入。 */
export const fetchOrcaChatModels = async (
  apiKey: string | undefined,
  fetchFn: FetchLike = fetch,
): Promise<ReturnType<typeof toPiModel>[]> => {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const url = new URL("/v1/models", ORCAROUTER_BASE_URL);
    url.searchParams.set("capability", "chat");
    const response = await fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const payload = (await response.json()) as OrcaModelCatalogResponse;
    const entries = payload.data ?? [];
    if (entries.length === 0) return ORCAROUTER_FALLBACK_MODELS;
    return toPiModelsFromCatalog(entries);
  } catch {
    return ORCAROUTER_FALLBACK_MODELS;
  }
};

/** 从刷新上下文里解析 API key：先存 credential（Settings 里填的 key 走
 *  Pi 的 auth.json），再退回环境变量。 */
const apiKeyFromContext = (context: { credential?: { type?: string; key?: string } }): string | undefined => {
  if (context.credential?.type === "api_key" && context.credential.key) return context.credential.key;
  return process.env[ORCAROUTER_API_KEY_ENV];
};

// ─── Provider 注册 ─────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI): Promise<void> {
  const config: ProviderConfig = {
    name: ORCAROUTER_PROVIDER_NAME,
    baseUrl: ORCAROUTER_BASE_URL,
    // 环境变量插值（与 ark-agent-plan 一致）：请求时 Pi 先解析
    // ORCAROUTER_API_KEY；用户在 Settings 里填过 key（存入 auth.json）后，
    // 存储的 credential 优先。key 始终留在服务端进程里，浏览器不持有。
    apiKey: `\${${ORCAROUTER_API_KEY_ENV}}`,
    api: "openai-completions",
    // Load once while Pi initializes the extension. This gives every new
    // session a complete catalog before pichamber snapshots available models;
    // fetchOrcaChatModels falls back locally when the key is unavailable.
    models: await fetchOrcaChatModels(process.env[ORCAROUTER_API_KEY_ENV]),
    refreshModels: async (context) => {
      const refreshed = await fetchOrcaChatModels(apiKeyFromContext(context));
      return refreshed;
    },
  };
  pi.registerProvider(ORCAROUTER_PROVIDER_ID, config);
}
