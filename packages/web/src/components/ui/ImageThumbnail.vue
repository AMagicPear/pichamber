<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import CloseIcon from "lucide-static/icons/x.svg";
import ImageViewer from "./ImageViewer.vue";

const props = withDefaults(defineProps<{
  src: string;
  alt: string;
  variant?: "composer" | "message" | "tool";
  removable?: boolean;
}>(), { variant: "message", removable: false });
const emit = defineEmits<{ remove: [] }>();
const { t } = useI18n();
const open = ref(false);
</script>

<template>
  <div class="image-preview" :class="`image-preview--${variant}`">
    <button
      type="button"
      class="image-preview__trigger"
      :aria-label="t('imagePreview.open', { image: alt })"
      @click="open = true"
    >
      <img :src="src" :alt="alt" loading="lazy" decoding="async" />
    </button>
    <button
      v-if="removable"
      type="button"
      class="image-preview__remove"
      :aria-label="t('composer.removeImage')"
      :title="t('composer.removeImage')"
      @click="emit('remove')"
    >
      <CloseIcon />
    </button>

    <ImageViewer :show="open" :src="src" :alt="alt" @close="open = false" />
  </div>
</template>

<style scoped>
.image-preview { position: relative; }
.image-preview__trigger {
  display: block;
  width: 100%;
  height: 100%;
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
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.image-preview--composer { width: 100%; height: 100%; }
.image-preview--composer .image-preview__trigger {
  border: 1px solid var(--ui-border);
  border-radius: 5px;
}
.image-preview--composer .image-preview__trigger img { object-fit: cover; }
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
.image-preview--message .image-preview__trigger { width: auto; height: auto; max-width: 100%; }
.image-preview--message .image-preview__trigger img {
  width: auto;
  max-width: 100%;
  max-height: 320px;
  border-radius: 8px;
}
.image-preview--tool .image-preview__trigger {
  width: auto;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
}
.image-preview--tool .image-preview__trigger img { width: auto; max-width: 100%; max-height: 320px; }
</style>
