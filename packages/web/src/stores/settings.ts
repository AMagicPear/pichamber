import { persistedState } from "./persisted";

interface SettingsState {
  hideTemporarySessions: boolean;
}

export const settings = persistedState<SettingsState>("pichamber.settings.v1", {
  hideTemporarySessions: true,
});
