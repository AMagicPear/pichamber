import { computed, defineComponent, type PropType } from "vue";
import type { FunctionalComponent, SVGAttributes } from "vue";
import fallbackLogoSrc from "lucide-static/icons/bot-message-square.svg";

type LogoComponent = FunctionalComponent<SVGAttributes>;
const fallbackLogo = fallbackLogoSrc as unknown as LogoComponent;

// 批量导入本地 SVG
const localLogoModules = import.meta.glob<LogoComponent>("../../assets/provider-logos/*.svg", {
  eager: true,
  import: "default",
  query: "?component",
});

const localLogos = new Map<string, LogoComponent>();
for (const [path, component] of Object.entries(localLogoModules)) {
  const match = path.replace(/\?component$/, "").match(/provider-logos\/([^/]+)\.svg$/i);
  if (match?.[1] && component) localLogos.set(match[1].toLowerCase(), component);
}

// 统一的 Provider 候选名称/关键词映射表
const providerAliases = {
  // 包含所有的精确别名和关键词别名
  "z.ai": "zai",
  azure: "azureai",
  codex: "openai",
  chatgpt: "openai",
  claude: "anthropic",
  google: "gemini",
  ollama: "ollama",
  evroc: "evroc",
  zai: "zai",
  moonshotai: "moonshotai",
  kimi: "moonshotai",
  volcengine: "volcengine",
  ark: "volcengine",
  xiaomi: "xiaomimimo",
  cloudflare: "cloudflare",
  opencode: "opencode",
  qwen: "qwen",
  minimax: "minimax",
  vercel: "vercel",
  xai: "grok",
  wafer: "wafer.ai",
} as const;

// Model 前缀映射表
const modelPrefixes = {
  gpt: "openai",
  o1: "openai",
  o3: "openai",
  o4: "openai",
  minimax: "minimax",
  deepseek: "deepseek",
  kimi: "moonshotai",
  k3: "moonshotai",
  glm: "zai",
  doubao: "doubao",
} as const;

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

  // 1. 完美匹配：优先进行文件名精确匹配
  const direct = localLogos.get(normalized);
  if (direct) return direct;

  // 2. 候选名称精确匹配：看别名表里有没有完整命中的
  const exactAlias = (providerAliases as Record<string, string>)[normalized];
  if (exactAlias) {
    const logo = localLogos.get(exactAlias);
    if (logo) return logo;
  }

  // 3. 候选名称关键词匹配：作为 provider 的降级方案
  for (const [keyword, logoKey] of Object.entries(providerAliases)) {
    if (normalized.includes(keyword)) {
      const logo = localLogos.get(logoKey);
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
    if (compact.startsWith(prefix)) return localLogos.get(logoKey);
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
    alt: { type: String, default: "" },
    class: { type: String, default: "" },
  },
  setup(props) {
    const Logo = computed(() => resolveLogo(props.providerId, props.modelId));
    return () => {
      const ResolvedLogo = Logo.value;
      return (
        <ResolvedLogo
          class={["provider-logo", props.class]}
          role="img"
          aria-label={props.alt || `${props.providerId || "model"} logo`}
          style={{
            color: "var(--ui-text)",
            display: "block",
            width: toPixels(props.size),
            height: toPixels(props.size),
            flex: "0 0 auto",
          }}
        />
      );
    };
  },
});
