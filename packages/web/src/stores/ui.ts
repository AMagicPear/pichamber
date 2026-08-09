import { reactive } from "vue";
import { persistedState } from "./persisted";

export type SplitMode = "bottom" | "left" | "right";

export interface PanelState {
  open: boolean;
  size: number;
}

export type PanelsState = Record<SplitMode, PanelState>;

const STORAGE_KEY = "pichamber.ui.v1";

const DEFAULT_PANELS: Readonly<PanelsState> = {
  bottom: { open: false, size: 225 },
  left: { open: true, size: 280 },
  right: { open: false, size: 356 },
};

const SPLIT_MODES: readonly SplitMode[] = ["bottom", "left", "right"];

const SIZE_LIMITS: Record<SplitMode, readonly [number, number]> = {
  left: [160, 600],
  right: [200, 600],
  bottom: [160, 600],
};

const clampSize = (mode: SplitMode, size: number): number => {
  const [min, configuredMax] = SIZE_LIMITS[mode];
  const max = Math.max(configuredMax, mode === "bottom" ? window.innerHeight : window.innerWidth);
  return Math.min(max, Math.max(min, size));
};

type StoredUi = { panels: PanelsState; maximized: Record<SplitMode, boolean> };

const defaultUi = (): StoredUi => ({
  panels: Object.fromEntries(
    SPLIT_MODES.map((mode) => [mode, { ...DEFAULT_PANELS[mode] }]),
  ) as PanelsState,
  maximized: { bottom: false, left: false, right: false },
});

/** Validate + clamp whatever survived in storage, falling back to defaults. */
const hydrate = (raw: Partial<StoredUi>): StoredUi => {
  const defaults = defaultUi();
  const panels = { ...defaults.panels };
  for (const mode of SPLIT_MODES) {
    const entry = raw.panels?.[mode];
    if (!entry || typeof entry !== "object") continue;
    panels[mode] = {
      open: typeof entry.open === "boolean" ? entry.open : defaults.panels[mode].open,
      size:
        typeof entry.size === "number" && Number.isFinite(entry.size)
          ? clampSize(mode, entry.size)
          : defaults.panels[mode].size,
    };
  }
  const maximized = { ...defaults.maximized };
  if (raw.maximized && typeof raw.maximized === "object") {
    for (const mode of SPLIT_MODES) {
      if (typeof raw.maximized[mode] === "boolean") maximized[mode] = raw.maximized[mode];
    }
  }
  return { panels, maximized };
};

const stored = persistedState<StoredUi>(STORAGE_KEY, defaultUi(), hydrate);

export const ui = reactive({
  panels: stored.panels,
  maximized: stored.maximized,
  settingsOpen: false,
  toggle(mode: SplitMode) {
    ui.panels[mode].open = !ui.panels[mode].open;
  },
  setSize(mode: SplitMode, size: number) {
    ui.panels[mode].size = clampSize(mode, size);
  },
  toggleMaximized(mode: SplitMode) {
    ui.maximized[mode] = !ui.maximized[mode];
  },
  setMaximized(mode: SplitMode, value: boolean) {
    ui.maximized[mode] = value;
  },
});
