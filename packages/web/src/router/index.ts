import { createRouter, createWebHistory } from "vue-router";
import SessionRouteView from "@/components/workspace/SessionRouteView.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/sessions/new",
      name: "new-session",
      component: SessionRouteView,
      props: { sessionId: null },
    },
    {
      path: "/sessions/:sessionId",
      name: "session",
      component: SessionRouteView,
      props: true,
    },
    { path: "/:pathMatch(.*)*", redirect: "/sessions/new" },
  ],
});

export default router
