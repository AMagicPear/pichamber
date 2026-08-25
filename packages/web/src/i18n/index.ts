/**
 * 多语言支持。
 *
 * 复用 persistedState（与 theme/settings 一致）持久化语言偏好，
 * 通过 vue-i18n 提供翻译。语言选择在设置面板中，见 SettingsView。
 * 偏好变化由 watch 自动同步到 i18n 实例，组件无需关心。
 */
import { createI18n } from "vue-i18n";
import { watch } from "vue";
import { persistedState } from "@/stores/persisted";
import en from "./locales/en";
import zh from "./locales/zh";

export type LocaleId = "en" | "zh" | "system";

/** Language options for the settings control. `labelKey` is resolved via
 *  `t()`; plain `label` values are endonyms (language names shown in their
 *  own script) that never need translating. */
export const localeOptions = [
  { id: "system", labelKey: "language.system" },
  { id: "en", label: "English" },
  { id: "zh", label: "简体中文" },
] as const;

const isLocaleId = (value: unknown): value is LocaleId =>
  value === "en" || value === "zh" || value === "system";

const localeState = persistedState<{ preference: LocaleId }>(
  "pichamber.locale.v1",
  { preference: "system" },
  (raw) => ({ preference: isLocaleId(raw.preference) ? raw.preference : "system" }),
);

/** Resolve a concrete locale ("en"|"zh") from a preference, expanding
 *  "system" using the browser language. */
const resolveLocale = (preference: LocaleId): "en" | "zh" => {
  if (preference !== "system") return preference;
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
};

export const i18n = createI18n({
  legacy: false,
  locale: resolveLocale(localeState.preference),
  fallbackLocale: "en",
  messages: { en, zh },
});

/** Persist + apply a language preference (system/en/zh). */
export const setLocale = (preference: LocaleId) => {
  localeState.preference = preference;
};

/** Current language preference (for the settings control). */
export const localePreference = () => localeState.preference;

// 偏好持久化后自动同步到 i18n 实例，语言切换即时生效。
watch(
  () => localeState.preference,
  (preference) => {
    i18n.global.locale.value = resolveLocale(preference);
  },
);
