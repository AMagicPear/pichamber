import { createApp } from "vue";
import "katex/dist/katex.min.css";
import { setCustomComponents } from "markstream-vue";
import "markstream-vue/index.css";

import App from "./App.vue";
import "@/assets/markdown.css";
import ConversationCodeBlock from "./components/workspace/ConversationCodeBlock.vue";
import LocalFileLink from "./components/workspace/LocalFileLink.vue";
import router from "./router";

const app = createApp(App);

setCustomComponents({
  code_block: ConversationCodeBlock,
  link: LocalFileLink,
});
app.use(router);

app.mount("#app");
