import { reactive } from "vue";

export const workspace = reactive({
  cwd: null as string | null,
  sessionId: null as string | null,
});
