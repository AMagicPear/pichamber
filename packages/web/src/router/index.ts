import ConversationPanel from "@/components/conversation/ConversationPanel.vue";
import { toMessage } from "@/api/client";
import {
  createSessionForCwd,
  sessionsError,
  updateWorkspace,
  workspace,
} from "@/stores/workspace";
import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/new",
      name: "new-session",
      component: ConversationPanel,
    },
    {
      path: "/:sessionId",
      name: "session",
      component: ConversationPanel,
    },
    { path: "/:pathMatch(.*)*", redirect: "/new" },
  ],
});

router.beforeEach(async (to) => {
  if (to.name === "new-session") {
    try {
      const sessionId = await createSessionForCwd(workspace.cwd ?? "~");
      return { name: "session", params: { sessionId }, replace: true };
    } catch (error) {
      sessionsError.value = toMessage(error);
      return false;
    }
  }
  if (to.name === "session" && typeof to.params.sessionId === "string") {
    if (!(await updateWorkspace(to.params.sessionId))) return { name: "new-session", replace: true };
  }
});

export default router;
