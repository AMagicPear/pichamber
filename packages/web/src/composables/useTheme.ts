import { computed, readonly, ref } from "vue";
import { persistedState } from "@/stores/persisted";

export const themeOptions = [
  { id: "system", label: "System", description: "Match your device appearance." },
  { id: "light", label: "Light", description: "Use the light interface." },
  { id: "dark", label: "Dark", description: "Use the dark interface." },
] as const;

export type ThemePreference = (typeof themeOptions)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const themeState = persistedState<{ preference: ThemePreference }>(
  "pichamber.theme.v1",
  { preference: "system" },
  (raw) => ({
    preference: themeOptions.some((option) => option.id === raw.preference)
      ? raw.preference as ThemePreference
      : "system",
  }),
);

const systemTheme = ref<ResolvedTheme>("light");
const resolvedTheme = computed<ResolvedTheme>(() =>
  themeState.preference === "system" ? systemTheme.value : themeState.preference,
);
let initialized = false;

const applyTheme = () => {
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme.value;
  root.style.colorScheme = resolvedTheme.value;
};

export const initializeTheme = () => {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const syncSystemTheme = () => {
    systemTheme.value = media.matches ? "dark" : "light";
    applyTheme();
  };
  syncSystemTheme();
  media.addEventListener("change", syncSystemTheme);
};

export const useTheme = () => {
  const setTheme = (preference: ThemePreference) => {
    themeState.preference = preference;
    if (typeof document !== "undefined") applyTheme();
  };

  return {
    preference: computed(() => themeState.preference),
    resolvedTheme: readonly(resolvedTheme),
    options: themeOptions,
    setTheme,
  };
};
