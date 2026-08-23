<script setup lang="ts">
defineProps<{
  open: boolean;
  /** Fixed-position style computed by usePopover. */
  style: Record<string, string>;
  /** Optional fixed panel width; height is always content-driven. */
  width?: number;
  /** Optional minimum width override for compact menus. */
  minWidth?: number;
  /** Optional maximum height for content-driven panels. */
  maxHeight?: number;
  /** Unique identifier used by usePopover to measure this panel. */
  panelId?: string;
  role?: string;
  ariaLabel?: string;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="popover">
      <div
        v-if="open"
        class="floating-panel"
        :data-popover-id="panelId"
        :role="role ?? 'menu'"
        :aria-label="ariaLabel"
        :style="[
          style,
          width != null && { width: `${width}px` },
          minWidth != null && { minWidth: `${minWidth}px` },
          maxHeight != null && { maxHeight: `${maxHeight}px` },
        ]"
        v-bind="$attrs"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.floating-panel {
  z-index: 1000;
  display: flex;
  flex-direction: column;
  min-width: 160px;
  max-height: calc(100vh - 80px);
  overflow: hidden;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-raised);
}
</style>
