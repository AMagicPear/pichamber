import { defineStore } from "pinia";

export type SplitMode = "left" | "right" | "bottom";

export const useUiStore = defineStore("ui", {
  state: () => ({
    panels: {
      left: { open: true },
      right: { open: true },
      bottom: { open: true },
    },
  }),
  actions: {
    toggle(mode: SplitMode) {
      this.panels[mode].open = !this.panels[mode].open;
    },
  },
});
