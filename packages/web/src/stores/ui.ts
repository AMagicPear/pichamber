import { defineStore } from "pinia";

export type SplitMode = "left" | "right" | "bottom" | "settings";

export interface PanelState {
  open: boolean;
  size: number;
}

export type PanelsState = Record<SplitMode, PanelState>;

const STORAGE_KEY = "pichamber.ui.v1";

const DEFAULT_PANELS: Readonly<PanelsState> = {
  left: { open: true, size: 280 },
  right: { open: true, size: 356 },
  bottom: { open: true, size: 225 },
  settings: { open: true, size: 216 },
};

const SPLIT_MODES: readonly SplitMode[] = ["left", "right", "bottom", "settings"];

const SIZE_LIMITS: Record<SplitMode, readonly [number, number]> = {
  left: [160, 600],
  right: [160, 600],
  bottom: [160, 600],
  settings: [176, 280],
};

function createDefaultPanels(): PanelsState {
  return Object.fromEntries(
    SPLIT_MODES.map((mode) => [mode, { ...DEFAULT_PANELS[mode] }]),
  ) as PanelsState;
}

function clampSize(mode: SplitMode, size: number): number {
  const [min, max] = SIZE_LIMITS[mode];
  return Math.min(max, Math.max(min, size));
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadPanels(): PanelsState | null {
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
      const open =
        typeof entry.open === "boolean" ? entry.open : DEFAULT_PANELS[mode].open;
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
}

function savePanels(panels: PanelsState): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ panels }));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export const useUiStore = defineStore("ui", {
  state: () => ({
    panels: loadPanels() ?? createDefaultPanels(),
  }),
  actions: {
    toggle(mode: SplitMode) {
      this.panels[mode].open = !this.panels[mode].open;
    },
    setSize(mode: SplitMode, size: number) {
      this.panels[mode].size = clampSize(mode, size);
    },
  },
});

/**
 * Subscribe to the store once per app lifetime so the latest panel sizes
 * and open-states are flushed to localStorage.
 */
let persistenceStarted = false;

export function startUiStorePersistence(): void {
  if (persistenceStarted) return;
  persistenceStarted = true;
  const ui = useUiStore();
  ui.$subscribe((_mutation, state) => {
    savePanels(state.panels as PanelsState);
  });
}
