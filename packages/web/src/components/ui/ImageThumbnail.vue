<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import CloseIcon from "lucide-static/icons/x.svg";
import ImageViewer from "./ImageViewer.vue";

const props = withDefaults(defineProps<{
  src: string;
  alt: string;
  title?: string;
  intrinsicWidth?: number;
  variant?: "composer" | "markdown" | "message" | "tool";
  removable?: boolean;
}>(), { variant: "message", removable: false });
const emit = defineEmits<{ remove: []; imageLoad: [width: number, height: number] }>();
const { t } = useI18n();
const open = ref(false);
const onImageLoad = (event: Event) => {
  const image = event.currentTarget as HTMLImageElement;
  emit("imageLoad", image.naturalWidth, image.naturalHeight);
};
</script>

<template>
  <component :is="variant === 'markdown' ? 'span' : 'div'" class="image-preview" :class="`image-preview--${variant}`">
    <button
      type="button"
      class="image-preview__trigger"
      :aria-label="t('imagePreview.open', { image: alt })"
      @click="open = true"
    >
      <img
        :src="src"
        :alt="alt"
        :title="title"
        :style="intrinsicWidth ? { width: `${intrinsicWidth}px` } : undefined"
        loading="lazy"
        decoding="async"
        @load="onImageLoad"
      />
    </button>
    <button
      v-if="removable"
      type="button"
      class="image-preview__remove"
      :aria-label="t('composer.removeImage')"
      :title="t('composer.removeImage')"
      @click.stop="emit('remove')"
    >
      <CloseIcon />
    </button>

    <ImageViewer :show="open" :src="src" :alt="alt" @close="open = false" />
  </component>
</template>

<style scoped>
.image-preview {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.image-preview__trigger {
  display: inline-block;
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: zoom-in;
}
.image-preview__trigger:focus-visible,
.image-preview__remove:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: 2px;
}
.image-preview__trigger img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 320px;
  border-radius: 8px;
}

.image-preview--composer {
  display: block;
  width: 100%;
  height: 100%;
}
.image-preview--composer .image-preview__trigger {
  width: 100%;
  height: 100%;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
}
.image-preview--composer .image-preview__trigger img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px;
}

.image-preview--tool .image-preview__trigger {
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
}

.image-preview__remove {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-flex;
  width: 15px;
  height: 15px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  background: var(--ui-surface);
  color: var(--ui-text-muted);
  cursor: pointer;
}
.image-preview__remove:hover { color: var(--ui-text-strong); background: var(--ui-surface-hover); }
.image-preview__remove :deep(svg) { width: 10px; height: 10px; }
</style>
