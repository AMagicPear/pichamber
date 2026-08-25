import { createApp } from "vue";
import "katex/dist/katex.min.css";
import { setCustomComponents } from "markstream-vue";
import "markstream-vue/index.css";
import "@/styles/markdown.css";
import "@/styles/tokens.css";
import "@/styles/utilities.css";
import "@/styles/panels.css";

import App from "./App.vue";
import LocalFileLink from "./components/ui/LocalFileLink.vue";
import router from "./router";
import { initializeTheme } from "./stores/theme";
import { i18n } from "./i18n";

initializeTheme();

const app = createApp(App);
app.use(i18n);

setCustomComponents("chat", {
  link: LocalFileLink,
});
app.use(router);

app.mount("#app");
