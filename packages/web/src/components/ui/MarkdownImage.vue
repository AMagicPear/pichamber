<script setup lang="ts">
import { computed, ref } from "vue";
import ImageThumbnail from "./ImageThumbnail.vue";
import { workspace } from "@/stores/workspace";

/** Structural peek at the image node so we don't type-import markstream's
 *  ImageNodeProps into defineProps (the SFC compiler can't resolve it
 *  without an fs option, which the @vitejs/plugin-vue + bun + rolldown
 *  pipeline doesn't supply — see LocalFileLink.vue for the same fix). */
type ImageNode = {
  src: string;
  alt: string;
  title: string | null;
};

const props = defineProps<{ node: ImageNode }>();

const src = computed(() => {
  const value = props.node.src;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  const params = new URLSearchParams({ sessionId: workspace.sessionId ?? "", path: value });
  return `/api/fs/raw?${params}`;
});
const isSvg = computed(() => /\.svg(?:$|[?#])/i.test(props.node.src));
const intrinsicWidth = ref<number>();
const setIntrinsicWidth = (width: number, height: number) => {
  if (!isSvg.value || !height) return;
  intrinsicWidth.value = width * Math.min(1, 320 / height);
};
</script>

<template>
  <ImageThumbnail
    :src="src"
    :alt="node.alt"
    :title="node.title ?? undefined"
    :intrinsic-width="intrinsicWidth"
    variant="markdown"
    @image-load="setIntrinsicWidth"
  />
</template>
