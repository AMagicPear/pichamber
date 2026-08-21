<script setup lang="ts">
/* Generic floating panel shell: anchoring, chrome, and scrollable body.
 * ComposerShelf (@ / file picker) and ActivityPanel (extension widgets)
 * share the exact same outer shape — header with kind label + right-side
 * hint, scrollable body, optional footer — so the shell lives here and
 * the two panels only own their content. Slotting keeps the API loose:
 * the shell doesn't care whether the title is clickable, the body is a
 * list, or there's a footer at all. */
defineProps<{
  /** Visible title in the header (e.g. "Files", "Activity"). */
  title: string;
  /** Right-side header text (e.g. "Live" or "@query"). Defaults to the
   *  `hint` slot's content; passes through if neither is set. */
  hint?: string;
  /** DOM id for the surface element; needed for the collapsible title's
   *  `aria-controls` and for external `aria-controls` references. */
  id?: string;
  /** When true, the header title renders as a button and emits `toggle`.
   *  Use for panels the user can dismiss from the header itself, not
   *  just from an external toggle button. */
  collapsible?: boolean;
  /** Element role; defaults to "dialog" since the panel is a temporary
   *  surface that doesn't change page navigation. */
  role?: "dialog" | "region" | "listbox";
}>();

const emit = defineEmits<{
  /** Fired when the user clicks the header title (only when `collapsible`). */
  toggle: [];
}>();
</script>

<template>
  <section
    :id="id"
    class="floating-panel"
    :role="role ?? 'dialog'"
    :aria-label="title"
  >
    <header class="floating-panel__header">
      <component
        :is="collapsible ? 'button' : 'span'"
        :type="collapsible ? 'button' : undefined"
        class="floating-panel__title"
        :class="{ 'is-clickable': collapsible }"
        :aria-controls="collapsible ? id : undefined"
        @click="collapsible && emit('toggle')"
      >
        <slot name="title-icon" />
        <span>{{ title }}</span>
      </component>
      <span v-if="hint !== undefined || $slots.hint" class="floating-panel__hint">
        <slot name="hint">{{ hint }}</slot>
      </span>
    </header>
    <div class="floating-panel__body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="floating-panel__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
/* Anchored to the bottom of the parent's positioning context — the parent
 * must have `position: relative` (the composer does). The +2px width and
 * -1px left nudge the border flush with the parent's edges so the panel
 * reads as a continuous surface, not a separate floating card. */
.floating-panel {
  position: absolute;
  z-index: 40;
  bottom: calc(100% - 1px);
  left: -1px;
  display: flex;
  width: calc(100% + 2px);
  max-height: min(34vh, 280px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ui-border-focus);
  border-bottom-color: var(--ui-border);
  border-radius: 10px 10px 0 0;
  background: var(--ui-surface);
  box-shadow: 0 -12px 30px rgb(33 31 26 / 10%);
}
.floating-panel__header,
.floating-panel__footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  color: var(--ui-text-muted);
  font-size: 11px;
}
.floating-panel__header {
  justify-content: space-between;
  min-height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-surface-subtle);
}
.floating-panel__title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-strong);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 0;
}
.floating-panel__title.is-clickable {
  cursor: pointer;
}
.floating-panel__title.is-clickable:hover {
  color: var(--ui-text);
}
/* The icon is provided via the #title-icon slot from a parent component,
 * so Vue's scoped style rewrite would otherwise drop the rule (the SVG
 * element doesn't carry our data-v attribute). Without an explicit size
 * the SVG collapses to 0×0, which squashes the title element and
 * forces short labels like "Pi commands" to wrap onto two lines.
 * `:deep()` reaches into the slot content to pin the icon's box. */
.floating-panel__title :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}
.floating-panel__hint {
  font-family: var(--ui-font-mono);
  font-size: 10px;
}
.floating-panel__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding: 5px;
  overflow-x: hidden;
  overflow-y: auto;
}
.floating-panel__footer {
  gap: 12px;
  min-height: 27px;
  padding: 0 12px;
  border-top: 1px solid var(--ui-border-subtle);
  background: var(--ui-surface-subtle);
}
.floating-panel__footer :deep(span) { color: var(--ui-text-muted); }
@media (max-width: 640px) {
  .floating-panel { max-height: 40vh; }
}
</style>