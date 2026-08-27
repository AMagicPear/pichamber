<script setup lang="ts">
import CloseIcon from "lucide-static/icons/x.svg";
import IconButton from "@/components/ui/IconButton.vue";

defineProps<{
  ariaLabel: string;
  closeLabel?: string;
  dismissible?: boolean;
}>();

defineEmits<{ close: [] }>();
</script>

<template>
  <section class="composer-surface" role="dialog" :aria-label="ariaLabel">
    <header class="composer-surface__header">
      <div class="composer-surface__title"><slot name="title" /></div>
      <div class="composer-surface__actions">
        <slot name="meta" />
        <IconButton v-if="dismissible" size="compact" :label="closeLabel ?? ariaLabel" @click="$emit('close')">
          <CloseIcon aria-hidden="true" />
        </IconButton>
      </div>
    </header>
    <div class="composer-surface__body"><slot /></div>
  </section>
</template>

<style scoped>
.composer-surface {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px 12px 0 0;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-raised);
}
.composer-surface__header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  padding: 0 8px 0 11px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-surface-subtle);
}
.composer-surface__title,
.composer-surface__actions { display: inline-flex; min-width: 0; align-items: center; }
.composer-surface__title { flex: 1 1 auto; overflow: hidden; }
.composer-surface__actions { flex: 0 0 auto; gap: 9px; }
.composer-surface__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  box-sizing: border-box;
  padding-bottom: var(--composer-surface-overlap, 0px);
  overflow: hidden;
}
</style>
