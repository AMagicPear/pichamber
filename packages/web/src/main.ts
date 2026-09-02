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
import MarkdownImage from "./components/ui/MarkdownImage.vue";
import router from "./router";
import { initializeTheme } from "./stores/theme";
import { initializeSessionEffects } from "./stores/sessionEffects";
import { i18n } from "./i18n";
import { getDiagnostics } from "./diagnostics/browser-events";

initializeTheme();
initializeSessionEffects();

const app = createApp(App);
app.use(i18n);

setCustomComponents("chat", {
  link: LocalFileLink,
  image: MarkdownImage,
});
app.use(router);

void getDiagnostics().then((handle) => {
  handle.installGlobalHandlers(app);
});

app.mount("#app");
