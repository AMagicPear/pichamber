import { createApp } from "vue";
import "katex/dist/katex.min.css";
import { preloadCodeBlockRuntime, setCustomComponents } from "markstream-vue";
import "markstream-vue/index.css";
import "@/styles/tokens.css";
import "@/styles/utilities.css";
import "@/styles/panels.css";

import App from "./App.vue";
import "@/assets/markdown.css";
import ConversationCodeBlock from "./components/workspace/ConversationCodeBlock.vue";
import LocalFileLink from "./components/workspace/LocalFileLink.vue";
import router from "./router";
import { initializeTheme } from "./composables/useTheme";

initializeTheme();

const app = createApp(App);

setCustomComponents({
  code_block: ConversationCodeBlock,
  link: LocalFileLink,
});
app.use(router);

// 预加载代码块运行时（stream-diffs/pierre）：刷新后首帧渲染不用等动态加载。
void preloadCodeBlockRuntime();

app.mount("#app");
