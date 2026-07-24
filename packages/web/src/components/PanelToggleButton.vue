<script setup lang="ts">
import IconButton from "@/components/IconButton.vue";
import { useUiStore, type SplitMode } from "@/stores/ui";

withDefaults(
  defineProps<{
    panel: SplitMode;
    label: string;
    size?: "compact" | "standard" | "large";
  }>(),
  { size: "standard" },
);

const ui = useUiStore();
</script>

<template>
  <IconButton
    :label="label"
    :size="size"
    :pressed="ui.panels[panel].open"
    @click="ui.toggle(panel)"
  >
    <slot />
  </IconButton>
</template>
