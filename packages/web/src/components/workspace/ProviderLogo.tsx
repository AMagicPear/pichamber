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

const normalize = (value: string) =>
  value.toLowerCase().trim().replace(/^models\./, "").replace(/^provider\./, "").replace(/\s+/g, "-");

const candidatesFor = (providerId: string) => {
  const normalized = normalize(providerId);
  if (!normalized) return [];
  const compact = normalized.replace(/[^a-z0-9_\-./:]/g, "");
  const primary = compact.split(/[/:]/)[0] || compact;
  return [...new Set([aliases.get(compact), aliases.get(primary), compact, primary].filter(Boolean))] as string[];
};

const localSourceFor = (providerId: string) => {
  const candidates = candidatesFor(providerId);
  const id = candidates.find((candidate) => localLogos.has(candidate));
  return id ? localLogos.get(id) ?? null : null;
};

export default defineComponent({
  name: "ProviderLogo",
  props: {
    providerId: { type: String, default: "" },
    size: { type: [Number, String] as PropType<number | string>, default: 16 },
    alt: { type: String, default: "" },
    class: { type: String, default: "" },
  },
  setup(props) {
    const localSrc = computed(() => localSourceFor(props.providerId));
    const remoteId = computed(() => candidatesFor(props.providerId)[0] ?? null);
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
            class: ["provider-logo", props.class],
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
