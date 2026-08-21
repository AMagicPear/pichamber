import { computed, ref } from "vue";
import { persistedState } from "@/stores/persisted";

/** 主题偏好/系统主题等跨组件共享状态。按模块级 store 模式集中，
 *  组件直接 import，不再经 useTheme composable 中转。 */
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
      ? (raw.preference as ThemePreference)
      : "system",
  }),
);

const systemTheme = ref<ResolvedTheme>("light");
export const activeTheme = computed<ResolvedTheme>(() =>
  themeState.preference === "system" ? systemTheme.value : themeState.preference,
);
export const preference = computed(() => themeState.preference);

let initialized = false;

const applyTheme = () => {
  const root = document.documentElement;
  root.dataset.theme = activeTheme.value;
  root.style.colorScheme = activeTheme.value;
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

export const setTheme = (preferenceValue: ThemePreference) => {
  themeState.preference = preferenceValue;
  if (typeof document !== "undefined") applyTheme();
};
