<script setup lang="ts">
/**
 * Shared teleported menu panel for all composer popovers (model selector,
 * thinking selector, attach menu, …).
 *
 * Owns only what the popovers share: the Teleport + global `.popover`
 * transition, the uniform panel container, and the `.menu-item` classes
 * applied to slot content. Open state and fixed-position math live in
 * `usePopover`; the item's accent color can be overridden per menu via the
 * `--menu-item-active-bg` / `--menu-item-active-color` CSS custom
 * properties (defaults to the blue interactive color).
 */
defineProps<{
  open: boolean;
  /** Fixed-position style computed by usePopover. */
  style: Record<string, string>;
  /** Optional fixed panel size; defaults to content-driven sizing. */
  width?: number;
  height?: number;
  role?: string;
  ariaLabel?: string;
}>();
</script>

<template>
  <Teleport to="body">
    <Transition name="popover">
      <div
        v-if="open"
        class="menu-panel"
        :role="role ?? 'menu'"
        :aria-label="ariaLabel"
        :style="[
          style,
          width != null && { width: `${width}px` },
          height != null && { height: `${height}px` },
        ]"
        v-bind="$attrs"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Teleported to <body>; scoped attributes keep the container rules matching
 * after teleport. Slot content is rendered by the parent component, so the
 * item rules use :deep() to reach it. */
.menu-panel {
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
.menu-panel :deep(.menu-item) {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 4px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu-panel :deep(.menu-item:hover) {
  background: var(--ui-surface-hover);
}
.menu-panel :deep(.menu-item.is-active) {
  background: var(--menu-item-active-bg, rgb(57 120 212 / 12%));
  color: var(--menu-item-active-color, #1f3a6b);
}
.menu-panel :deep(.menu-item:focus-visible) {
  outline: 2px solid var(--ui-focus);
  outline-offset: -2px;
}
.menu-panel :deep(.menu-item svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}
/* Items with a right-aligned hint (e.g. thinking levels). */
.menu-panel :deep(.menu-item--split) {
  justify-content: space-between;
  gap: 12px;
}
.menu-panel :deep(.menu-item__hint) {
  color: var(--ui-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
