<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <section class="settings-group">
    <h2>{{ title }}</h2>
    <slot />
  </section>
</template>

<style scoped>
.settings-group { display: grid; max-width: 720px; gap: 10px; }
.settings-group h2 { margin: 0; color: var(--ui-text-muted); font-size: 12px; font-weight: 500; }
</style>
