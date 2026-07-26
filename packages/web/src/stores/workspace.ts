import { defineStore } from "pinia";

export const useWorkspaceStore = defineStore("workspace", {
  state: () => ({
    cwd: null as string | null,
    sessionId: null as string | null,
  }),
  actions: {
    
  },
});
