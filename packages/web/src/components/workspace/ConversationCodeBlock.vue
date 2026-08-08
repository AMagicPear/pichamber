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
  await next.finalize({ view: "file" });
};

onMounted(() => void render());
onBeforeUnmount(() => controller?.dispose());
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
