import { reactive, watch } from "vue";

const STORAGE_KEY = "pichamber.settings.v1";

interface SettingsState {
  hideTemporarySessions: boolean;
}

const defaults: SettingsState = {
  hideTemporarySessions: true,
};

const hasStorage = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const loadSettings = (): SettingsState => {
  if (!hasStorage()) return { ...defaults };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      ...defaults,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  } catch {
    return { ...defaults };
  }
};

const saveSettings = (value: SettingsState) => {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore quota and privacy-mode errors.
  }
};

export const settings = reactive<SettingsState>(loadSettings());

watch(settings, (value) => saveSettings(value), { deep: true });
