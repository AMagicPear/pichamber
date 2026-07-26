import { reactive } from "vue";

export const workspace = reactive({
  // Debug default: the server resolves the active workspace to the user's home.
  // FileTree replaces this marker with the canonical path after its first load.
  cwd: "~" as string | null,
  sessionId: null as string | null,
});
