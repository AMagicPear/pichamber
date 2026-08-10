<script setup lang="ts">
import { createCodeStream } from "stream-diffs";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  node: {
    code?: string;
    language?: string;
  };
}>();

const host = ref<HTMLElement>();
let controller: ReturnType<typeof createCodeStream> | undefined;
let viewportObserver: IntersectionObserver | undefined;

const render = async () => {
  controller?.dispose();
  if (!host.value) return;

  const next = createCodeStream({
    fileName: `code.${props.node.language || "txt"}`,
    language: props.node.language || "plaintext",
    theme: { light: "vitesse-light", dark: "vitesse-dark" },
    lineNumbers: true,
  });
  controller = next;
  await next.mount(host.value);
  if (controller !== next) return;
  next.updateSnapshot(props.node.code || "");
  // disableFileHeader：pierre File surface 默认渲染文件名 header（无语言时
  // 默认名 code.txt）——代码块不该显示文件名，直接禁掉。
  await next.finalize({ view: "file", disableFileHeader: true });
};

/** 首次挂载时容器可能尚未布局（刷新后滚动恢复 / content-visibility 跳过），
 *  pierre 的虚拟化会按 0 高度渲染成空白。进入视口后若内容高度仍为 0，重挂一次。 */
const renderIfEmpty = () => {
  const el = host.value;
  if (!el) return;
  const child = el.firstElementChild;
  const height = child?.getBoundingClientRect().height ?? el.getBoundingClientRect().height;
  if (height <= 0) void render();
};

onMounted(() => {
  void render();
  viewportObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        viewportObserver?.disconnect();
        renderIfEmpty();
      }
    },
    { threshold: 0.01 },
  );
  viewportObserver.observe(host.value!);
});
onBeforeUnmount(() => {
  viewportObserver?.disconnect();
  controller?.dispose();
});
watch(() => [props.node.code, props.node.language], () => void render());
</script>

<template>
  <div ref="host" class="conversation-code-block" />
</template>

<style scoped>
.conversation-code-block {
  overflow: hidden;
  border: 1px solid #e4e1da;
  border-radius: 6px;
}
.conversation-code-block :deep(.stream-diffs-shell) {
  max-height: 36rem;
}
</style>
