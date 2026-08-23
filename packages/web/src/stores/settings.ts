import { persistedState } from "./persisted";

export type SendKey = "enter" | "modEnter";

export interface SettingsState {
  /** Filter `/tmp` and macOS temp sessions out of the sidebar. */
  hideTemporarySessions: boolean;
  /** Submit-on-Enter (current default) vs submit on Cmd/Ctrl+Enter. */
  sendKey: SendKey;
  /** Render a local timestamp under each committed message (default on). */
  showTimestamps: boolean;
  /** Render committed tool result details expanded by default. */
  expandedToolResults: boolean;
  /** Play a short chime when the agent turn completes. */
  notifySound: boolean;
  /** Fire a desktop notification when the agent turn completes. */
  notifyDesktop: boolean;
  /** Refresh remote Git refs while the Git panel is open. */
  gitAutoFetch: boolean;
}

const isSendKey = (value: unknown): value is SendKey => value === "enter" || value === "modEnter";

const hydrate = (raw: Partial<SettingsState>): SettingsState => ({
  hideTemporarySessions:
    typeof raw.hideTemporarySessions === "boolean" ? raw.hideTemporarySessions : true,
  sendKey: isSendKey(raw.sendKey) ? raw.sendKey : "enter",
  showTimestamps: typeof raw.showTimestamps === "boolean" ? raw.showTimestamps : true,
  expandedToolResults:
    typeof raw.expandedToolResults === "boolean" ? raw.expandedToolResults : false,
  notifySound: typeof raw.notifySound === "boolean" ? raw.notifySound : false,
  notifyDesktop: typeof raw.notifyDesktop === "boolean" ? raw.notifyDesktop : false,
  gitAutoFetch: typeof raw.gitAutoFetch === "boolean" ? raw.gitAutoFetch : true,
});

export const settings = persistedState<SettingsState>(
  "pichamber.settings.v1",
  {
    hideTemporarySessions: true,
    sendKey: "enter",
    showTimestamps: true,
    expandedToolResults: false,
    notifySound: false,
    notifyDesktop: false,
    gitAutoFetch: true,
  },
  hydrate,
);
