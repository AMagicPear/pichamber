<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
}>();
</script>

<template>
  <header class="settings-page-header">
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
  </header>
</template>

<style scoped>
.settings-page-header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 22px; }
.settings-page-header h1 { margin: 0; color: var(--ui-text-strong); font-size: 20px; font-weight: 600; line-height: 1.2; }
.settings-page-header p { margin: 0; color: var(--ui-text-muted); font-size: 14px; }
</style>
