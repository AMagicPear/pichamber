import { defineStore } from "pinia";

export type SplitMode = "left" | "right" | "bottom";

export const useUiStore = defineStore("ui", {
  state: () => ({
    panels: {
      left: { open: true },
      right: { open: false },
      bottom: { open: false },
    },
  }),
  actions: {
    toggle(mode: SplitMode) {
      this.panels[mode].open = !this.panels[mode].open;
    },
  },
});
