<script setup lang="ts">
import FileIcon from "@/assets/icons/FileText.svg";

defineProps<{
  name: string;
  location: string;
}>();
</script>

<template>
  <div class="skill-chip" :title="location">
    <span class="skill-chip__badge">
      <FileIcon class="skill-chip__icon" aria-hidden="true" />
      <span class="skill-chip__label">Skill</span>
    </span>
    <span class="skill-chip__name">{{ name }}</span>
  </div>
</template>

<style scoped>
.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 4px 6px 4px 4px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--ui-surface-subtle);
  font-size: 12px;
  line-height: 18px;
}
.skill-chip__badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--ui-skill-bg);
  color: var(--ui-skill-fg);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.skill-chip__icon {
  width: 11px;
  height: 11px;
  flex: 0 0 11px;
}
.skill-chip__name {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-strong);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>