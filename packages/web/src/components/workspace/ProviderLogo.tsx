import { computed, defineComponent, h, ref, watch, type PropType } from "vue";
import BrainAi3Icon from "@/assets/icons/BrainAi3.svg";

type LogoState = "local" | "remote" | "none";

const localLogoModules = import.meta.glob<string>("../../assets/provider-logos/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});

const localLogos = new Map<string, string>();
for (const [path, url] of Object.entries(localLogoModules)) {
  const match = path.match(/provider-logos\/([^/]+)\.svg$/i);
  if (match?.[1] && url) localLogos.set(match[1].toLowerCase(), url);
}

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
  value.toLowerCase().trim().replace(/^models\./, "").replace(/^provider\./, "").replace(/\s+/g, "-");

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

const localSourceFor = (providerId: string, modelId = "") => {
  const candidates = providerCandidates(providerId);
  const id = candidates.find((candidate) => localLogos.has(candidate));
  if (id) return localLogos.get(id) ?? null;
  return modelIdFallback(modelId)
    .map((candidate) => localLogos.get(candidate) ?? null)
    .find((src): src is string => src !== null) ?? null;
};

export default defineComponent({
  name: "ProviderLogo",
  props: {
    providerId: { type: String, default: "" },
    modelId: { type: String, default: "" },
    size: { type: [Number, String] as PropType<number | string>, default: 16 },
    alt: { type: String, default: "" },
    class: { type: String, default: "" },
  },
  setup(props) {
    /** Resolution order: provider aliases/local → model id prefix → remote
     *  fallback for the provider → model id prefix fallback → none. */
    const candidates = computed(() => {
      const fromProvider = providerCandidates(props.providerId);
      if (fromProvider.length > 0) return fromProvider;
      return modelIdFallback(props.modelId);
    });
    const localSrc = computed(() => localSourceFor(props.providerId, props.modelId));
    const remoteId = computed(() => candidates.value[0] ?? null);
    const state = ref<LogoState>(localSrc.value ? "local" : remoteId.value ? "remote" : "none");

    watch(
      [localSrc, remoteId],
      () => {
        state.value = localSrc.value ? "local" : remoteId.value ? "remote" : "none";
      },
    );

    const onError = () => {
      state.value = state.value === "local" && remoteId.value ? "remote" : "none";
    };

    const src = computed(() => {
      if (state.value === "local") return localSrc.value;
      if (state.value === "remote" && remoteId.value) return `https://models.dev/logos/${remoteId.value}.svg`;
      return null;
    });

    return () =>
      src.value
        ? h("img", {
            src: src.value,
            alt: props.alt || `${props.providerId} logo`,
            class: ["provider-logo", "provider-logo--image", props.class],
            width: props.size,
            height: props.size,
            style: { display: "block", objectFit: "contain" },
            loading: "eager",
            decoding: "async",
            draggable: false,
            onError,
          })
        : h(BrainAi3Icon, {
            class: ["provider-logo", "provider-logo--fallback", props.class],
            width: props.size,
            height: props.size,
            style: { display: "block" },
            "aria-label": props.alt || `${props.providerId || "model"} logo`,
          });
  },
});
