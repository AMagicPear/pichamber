<script setup lang="ts">
// Shared shimmer placeholder shown while a lazily-loaded panel's chunk
// resolves. Each `variant` sketches the rough shape of its real surface
// (terminal tabs, git action rows, file tree, stats) so the swap-in is
// less jarring. Rendered only after a short `delay` (default 150ms) so a
// fast local chunk load never flashes it.

withDefaults(
  defineProps<{
    variant?: "terminal" | "git" | "files" | "context" | "settings";
  }>(),
  { variant: "context" },
);
</script>

<template>
  <div class="panel-skeleton" :class="`is-${variant}`" aria-hidden="true">
    <template v-if="variant === 'terminal'">
      <!-- Tab strip + terminal body -->
      <div class="skeleton-tabs"><span class="skeleton-bar" style="width: 90px" /><span class="skeleton-bar" style="width: 130px" /></div>
      <div class="skeleton-body">
        <span class="skeleton-line" style="width: 52%" />
        <span class="skeleton-line" style="width: 74%" />
        <span class="skeleton-line" style="width: 38%" />
      </div>
    </template>

    <template v-else-if="variant === 'git'">
      <!-- Branch row + status list -->
      <div class="skeleton-row"><span class="skeleton-chip" style="width: 120px" /></div>
      <div v-for="i in 4" :key="i" class="skeleton-row">
        <span class="skeleton-badge" />
        <span class="skeleton-line" :style="{ width: `${62 - i * 6}%` }" />
      </div>
      <span class="skeleton-btn" style="width: 96px" />
    </template>

    <template v-else-if="variant === 'files'">
      <!-- Tree rows with varying indent -->
      <div v-for="i in 6" :key="i" class="skeleton-row" :style="{ paddingLeft: `${(i % 3) * 14}px` }">
        <span class="skeleton-chip" style="width: 18px; height: 14px" />
        <span class="skeleton-line" :style="{ width: `${70 - i * 7}%` }" />
      </div>
    </template>

    <template v-else-if="variant === 'settings'">
      <!-- Tabs + option rows -->
      <div class="skeleton-tabs"><span class="skeleton-chip" style="width: 64px" /><span class="skeleton-chip" style="width: 88px" /><span class="skeleton-chip" style="width: 72px" /></div>
      <div v-for="i in 4" :key="i" class="skeleton-row">
        <span class="skeleton-line" :style="{ width: `${64 - i * 7}%` }" />
      </div>
    </template>

    <template v-else>
      <!-- context: stats blocks -->
      <div v-for="i in 3" :key="i" class="skeleton-body">
        <span class="skeleton-line" style="width: 38%" />
        <span class="skeleton-line" style="width: 66%" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-height: 100%;
  padding: 18px 16px;
  box-sizing: border-box;
  color: var(--ui-text-muted);
}

/* Shared skeleton pieces — a soft block that gently pulses. */
.skeleton-bar,
.skeleton-line,
.skeleton-chip,
.skeleton-badge,
.skeleton-btn {
  display: block;
  border-radius: 4px;
  background: var(--ui-surface-selected);
  opacity: 0.55;
  animation: skeleton-pulse 1.4s var(--ui-ease-standard) infinite;
}
.skeleton-line {
  height: 10px;
}
.skeleton-tabs {
  display: flex;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.skeleton-bar {
  height: 14px;
}
.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 22px;
}
.skeleton-chip {
  height: 14px;
  flex: 0 0 auto;
}
.skeleton-badge {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border-radius: 5px;
}
.skeleton-btn {
  height: 28px;
  margin-top: 6px;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.82;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-bar,
  .skeleton-line,
  .skeleton-chip,
  .skeleton-badge,
  .skeleton-btn {
    animation: none;
    opacity: 0.55;
  }
}
</style>
