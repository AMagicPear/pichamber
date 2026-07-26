import ConversationPanel from "@/components/panels/ConversationPanel.vue";
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
    {
      path: "/debug",
      name: "debug",
      component: () => import("@/components/TestDebug.vue"),
    },
    { path: "/:pathMatch(.*)*", redirect: "/new" },
  ],
});

export default router;
