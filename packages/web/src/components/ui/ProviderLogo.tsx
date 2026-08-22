import { defineComponent, type PropType } from "vue";
import type { FunctionalComponent, SVGAttributes } from "vue";

type LogoComponent = FunctionalComponent<SVGAttributes>;

// Bundled as Vue components (vite-svg-loader) so each logo renders as a real
// inline <svg> — no <img> shell, no remote fetch, no scattered CSS. The
// component owns its sizing + theming: fills ride currentColor and the svg
// inherits the theme's --ui-text, so light/dark flips natively. The logos
// (provider marks + the models.dev fallback mark) all come out of one glob.
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

const fallbackLogo = localLogos.get("fallback")!;

const aliases = new Map([
  ["codex", "openai"],
  ["chatgpt", "openai"],
  ["claude", "anthropic"],
  ["gemini", "google"],
  ["evroc-ai", "evroc"],
  ["evrocai", "evroc"],
  ["ollama-cloud", "ollama"],
  ["wafer", "wafer.ai"],
]);

const namePrefixes = new Map([
  ["gpt-", "openai"],
  ["o1", "openai"],
  ["o3", "openai"],
  ["o4", "openai"],
]);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/^models\./, "")
    .replace(/^provider\./, "")
    .replace(/\s+/g, "-");

/** Candidates derived from the provider id alone — aliases, normalized
 *  provider string, and its primary segment. */
const providerCandidates = (providerId: string) => {
  const normalized = normalize(providerId);
  if (!normalized) return [];
  const compact = normalized.replace(/[^a-z0-9_\-./:]/g, "");
  const primary = compact.split(/[/:]/)[0] || compact;
  return [
    ...new Set([aliases.get(compact), aliases.get(primary), compact, primary].filter(Boolean)),
  ] as string[];
};

/** When the provider side yields nothing, fall back to a brand lookup by
 *  model id prefix (e.g. "gpt-4o" → "openai"). Returns a single-element
 *  candidate list — the brand key — or [] when no prefix matches. */
const modelIdFallback = (modelId: string) => {
  const normalized = normalize(modelId);
  if (!normalized) return [];
  const compact = normalized.replace(/[^a-z0-9_\-./:]/g, "");
  const hit = [...namePrefixes.entries()].find(([prefix]) => compact.startsWith(prefix))?.[1];
  return hit ? [hit] : [];
};

/** Resolve the bundled logo component for a provider/model. Falls back to the
 *  models.dev fallback mark when nothing matches. */
const resolveLogo = (providerId: string, modelId = ""): LogoComponent => {
  const candidates = providerCandidates(providerId);
  const fromProvider = candidates.map((c) => localLogos.get(c)).find(Boolean);
  if (fromProvider) return fromProvider;
  const fromModel = modelIdFallback(modelId)
    .map((c) => localLogos.get(c))
    .find(Boolean);
  return fromModel ?? fallbackLogo;
};

const toPixels = (size: number | string) => (typeof size === "number" ? `${size}px` : size);

export default defineComponent({
  name: "ProviderLogo",
  inheritAttrs: false,
  props: {
    providerId: { type: String, default: "" },
    modelId: { type: String, default: "" },
    size: { type: [Number, String] as PropType<number | string>, default: 16 },
    alt: { type: String, default: "" },
    class: { type: String, default: "" },
  },
  setup(props) {
    const Logo = resolveLogo(props.providerId, props.modelId);
    return () => (
      <Logo
        class={["provider-logo", props.class]}
        role="img"
        aria-label={props.alt || `${props.providerId || "model"} logo`}
        style={{
          color: "var(--ui-text)",
          fill: "currentColor",
          display: "block",
          width: toPixels(props.size),
          height: toPixels(props.size),
          flex: "0 0 auto",
        }}
      />
    );
  },
});
