import { computed, defineComponent, h, type PropType } from "vue";
import type { FunctionalComponent, SVGAttributes } from "vue";
import fallbackLogoSrc from "lucide-static/icons/bot-message-square.svg";

type LogoComponent = FunctionalComponent<SVGAttributes>;
const fallbackLogo = fallbackLogoSrc as unknown as LogoComponent;

// Lobe Icons 提供 200+ AI / LLM 品牌的纯色 SVG。通过官方静态资源包
// eager import，图标会随应用一起打包，不依赖 CDN。
// 参考：https://lobehub.com/icons/skill.md
const lobeIconModules = import.meta.glob<LogoComponent>(
  [
    "@lobehub/icons-static-svg/icons/openai.svg",
    "@lobehub/icons-static-svg/icons/anthropic.svg",
    "@lobehub/icons-static-svg/icons/azureai.svg",
    "@lobehub/icons-static-svg/icons/baseten.svg",
    "@lobehub/icons-static-svg/icons/bedrock.svg",
    "@lobehub/icons-static-svg/icons/cerebras.svg",
    "@lobehub/icons-static-svg/icons/cloudflare.svg",
    "@lobehub/icons-static-svg/icons/cursor.svg",
    "@lobehub/icons-static-svg/icons/deepseek.svg",
    "@lobehub/icons-static-svg/icons/doubao.svg",
    "@lobehub/icons-static-svg/icons/fireworks.svg",
    "@lobehub/icons-static-svg/icons/gemini.svg",
    "@lobehub/icons-static-svg/icons/githubcopilot.svg",
    "@lobehub/icons-static-svg/icons/grok.svg",
    "@lobehub/icons-static-svg/icons/groq.svg",
    "@lobehub/icons-static-svg/icons/huggingface.svg",
    "@lobehub/icons-static-svg/icons/lmstudio.svg",
    "@lobehub/icons-static-svg/icons/minimax.svg",
    "@lobehub/icons-static-svg/icons/mistral.svg",
    "@lobehub/icons-static-svg/icons/moonshot.svg",
    "@lobehub/icons-static-svg/icons/nvidia.svg",
    "@lobehub/icons-static-svg/icons/ollama.svg",
    "@lobehub/icons-static-svg/icons/openai.svg",
    "@lobehub/icons-static-svg/icons/opencode.svg",
    "@lobehub/icons-static-svg/icons/openrouter.svg",
    "@lobehub/icons-static-svg/icons/qwen.svg",
    "@lobehub/icons-static-svg/icons/together.svg",
    "@lobehub/icons-static-svg/icons/vercel.svg",
    "@lobehub/icons-static-svg/icons/volcengine.svg",
    "@lobehub/icons-static-svg/icons/xiaomimimo.svg",
    "@lobehub/icons-static-svg/icons/zai.svg",
    "@lobehub/icons-static-svg/icons/antgroup.svg",
  ],
  { eager: true, import: "default", query: "?component" },
);
const localIconModules = import.meta.glob<LogoComponent>(
  "../../assets/provider-logos/*.svg",
  { eager: true, import: "default", query: "?component" },
);

const lobeIcons = new Map<string, LogoComponent>();
for (const [path, component] of Object.entries({ ...lobeIconModules, ...localIconModules })) {
  const match = path.match(/(?:icons|provider-logos)\/([^/]+)\.svg(?:\?component)?$/);
  if (match?.[1] && component) lobeIcons.set(match[1].toLowerCase(), component);
}

// 统一的 Provider 候选名称/关键词映射表
const providerAliases = {
  "z.ai": "zai",
  azure: "azureai",
  bedrock: "bedrock",
  codex: "openai",
  chatgpt: "openai",
  claude: "anthropic",
  google: "gemini",
  ollama: "ollama",
  evroc: "evroc",
  zai: "zai",
  moonshotai: "moonshot",
  moonshot: "moonshot",
  kimi: "moonshot",
  volcengine: "volcengine",
  ark: "volcengine",
  xiaomi: "xiaomimimo",
  xiaomimimo: "xiaomimimo",
  cloudflare: "cloudflare",
  opencode: "opencode",
  qwen: "qwen",
  minimax: "minimax",
  vercel: "vercel",
  xai: "grok",
  grok: "grok",
  wafer: "wafer.ai",
  "ant-ling": "antgroup",
  antgroup: "antgroup",
  "github-copilot": "githubcopilot",
  githubcopilot: "githubcopilot",
  "amazon-bedrock": "bedrock",
} as const;

// Model 前缀映射表
const modelPrefixes = {
  gpt: "openai",
  o1: "openai",
  o3: "openai",
  o4: "openai",
  minimax: "minimax",
  deepseek: "deepseek",
  kimi: "moonshot",
  k3: "moonshot",
  glm: "zai",
  doubao: "doubao",
} as const;

const lookup = (logoKey: string): LogoComponent | undefined => lobeIcons.get(logoKey);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/^models\./, "")
    .replace(/^provider\./, "")
    .replace(/\s+/g, "-");

const logoFromProvider = (providerId: string | undefined): LogoComponent | undefined => {
  if (!providerId) return undefined;
  const normalized = normalize(providerId);
  if (!normalized) return undefined;

  // 1. 完美匹配：优先按 lobe-icons key 直接查找
  const direct = lookup(normalized);
  if (direct) return direct;

  // 2. 候选名称精确匹配：看别名表里有没有完整命中的
  const exactAlias = (providerAliases as Record<string, string>)[normalized];
  if (exactAlias) {
    const logo = lookup(exactAlias);
    if (logo) return logo;
  }

  // 3. 候选名称关键词匹配：作为 provider 的降级方案
  for (const [keyword, logoKey] of Object.entries(providerAliases)) {
    if (normalized.includes(keyword)) {
      const logo = lookup(logoKey);
      if (logo) return logo;
    }
  }

  return undefined;
};

const logoFromModel = (modelId: string | undefined): LogoComponent | undefined => {
  if (!modelId) return undefined;
  const compact = normalize(modelId).replace(/[^a-z0-9_\-./:]/g, "");
  if (!compact) return undefined;

  // 4. Model 名称前缀匹配
  for (const [prefix, logoKey] of Object.entries(modelPrefixes)) {
    if (compact.startsWith(prefix)) return lookup(logoKey);
  }
  return undefined;
};

const resolveLogo = (providerId: string | undefined, modelId: string | undefined): LogoComponent =>
  // 严格遵循优先级：先试 Provider，全失败了再试 Model，最后 fallback
  logoFromProvider(providerId) ?? logoFromModel(modelId) ?? fallbackLogo;

const toPixels = (size: number | string) => (typeof size === "number" ? `${size}px` : size);

export default defineComponent({
  name: "ProviderLogo",
  inheritAttrs: false,
  props: {
    providerId: { type: String, default: undefined },
    modelId: { type: String, default: undefined },
    size: { type: [Number, String] as PropType<number | string>, default: 16 },
    color: { type: String, default: undefined },
    alt: { type: String, default: "" },
    class: { type: String, default: "" },
  },
  setup(props) {
    const logo = computed(() => resolveLogo(props.providerId, props.modelId));
    return () => (
      <logo.value
        class={["provider-logo", props.class]}
        role="img"
        aria-label={props.alt || `${props.providerId || "model"} logo`}
        style={{
          color: props.color ?? "var(--ui-text)",
          display: "block",
          width: toPixels(props.size),
          height: toPixels(props.size),
          flex: "0 0 auto",
        }}
      />
    );
  },
});
