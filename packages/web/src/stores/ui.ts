import { reactive, watch } from "vue";

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
  right: [300, 600],
  bottom: [160, 600],
};

const createDefaultPanels = (): PanelsState => {
  return Object.fromEntries(
    SPLIT_MODES.map((mode) => [mode, { ...DEFAULT_PANELS[mode] }]),
  ) as PanelsState;
};

const createDefaultMaximized = (): Record<SplitMode, boolean> => {
  return Object.fromEntries(SPLIT_MODES.map((mode) => [mode, false])) as Record<SplitMode, boolean>;
};

const hasStorage = (): boolean => {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
};

const loadMaximized = (): Record<SplitMode, boolean> => {
  if (!hasStorage()) return createDefaultMaximized();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    return (parsed.maximized as Record<SplitMode, boolean> | undefined) ?? createDefaultMaximized();
  } catch {
    return createDefaultMaximized();
  }
};

const clampSize = (mode: SplitMode, size: number): number => {
  const [min, configuredMax] = SIZE_LIMITS[mode];
  const max =
    typeof window !== "undefined"
      ? Math.max(
          configuredMax,
          mode === "left" || mode === "right" ? window.innerWidth : window.innerHeight,
        )
      : configuredMax;
  return Math.min(max, Math.max(min, size));
};

const loadPanels = (): PanelsState | null => {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const panels = (parsed as { panels?: unknown }).panels;
    if (!panels || typeof panels !== "object") return null;
    const source = panels as Record<string, unknown>;

    const hydrated: Partial<PanelsState> = {};
    for (const mode of SPLIT_MODES) {
      const entry = source[mode] as { open?: unknown; size?: unknown } | undefined;
      if (!entry || typeof entry !== "object") continue;
      const open = typeof entry.open === "boolean" ? entry.open : DEFAULT_PANELS[mode].open;
      const size =
        typeof entry.size === "number" && Number.isFinite(entry.size)
          ? clampSize(mode, entry.size)
          : DEFAULT_PANELS[mode].size;
      hydrated[mode] = { open, size };
    }
    return { ...DEFAULT_PANELS, ...hydrated };
  } catch {
    return null;
  }
};

const saveUiState = (panels: PanelsState, maximized: Record<SplitMode, boolean>) => {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ panels, maximized }));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
};

export const ui = reactive({
  panels: loadPanels() ?? createDefaultPanels(),
  maximized: loadMaximized(),
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

/**
 * Subscribe to the store once per app lifetime so the latest panel sizes
 * and open-states are flushed to localStorage.
 */
let persistenceStarted = false;

export const startUiStorePersistence = () => {
  if (persistenceStarted) return;
  persistenceStarted = true;
  watch(ui, () => {
    saveUiState(ui.panels, ui.maximized);
  }, { deep: true });
};
