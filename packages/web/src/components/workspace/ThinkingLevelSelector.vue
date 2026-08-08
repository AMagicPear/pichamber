<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AiGenerate2Icon from "@/assets/icons/AiGenerate2.svg";
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";

const props = defineProps<{
  level: ThinkingLevel;
  availableLevels: ThinkingLevel[];
}>();

const emit = defineEmits<{
  select: [level: ThinkingLevel];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
/** Same teleport trick as ModelSelector — the panel is rendered into
 *  <body> with `position: fixed` so it escapes the conversation's
 *  `overflow: hidden` when the composer is centered. Coordinates are
 *  measured from the trigger on every open/scroll/resize. */
const popoverStyle = ref<Record<string, string>>({});

const labels: Record<ThinkingLevel, string> = {
  off: "Build",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

const visibleLevels = computed<ThinkingLevel[]>(() =>
  // Always offer "off" so the user can opt out of reasoning, even when
  // the model doesn't expose a thinking-level ladder. The explicit return
  // type is required because Array.from() widens the Set iterator to
  // `string`, which Vue's template would then trip over.
  Array.from(new Set<ThinkingLevel>([...props.availableLevels, "off"])),
);

const PANEL_HEIGHT = computed(() => 12 + visibleLevels.value.length * 32);
const PANEL_WIDTH = 156;
const GAP = 6;

const updatePopoverPosition = () => {
  const trigger = root.value?.querySelector<HTMLElement>(".thinking-selector__trigger");
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const desiredTop = rect.top - PANEL_HEIGHT.value - GAP;
  const top = desiredTop >= 8 ? desiredTop : rect.bottom + GAP;
  popoverStyle.value = {
    position: "fixed",
    top: `${Math.max(8, top)}px`,
    left: `${Math.max(8, Math.min(window.innerWidth - PANEL_WIDTH - 8, rect.right - PANEL_WIDTH))}px`,
  };
};

const currentLabel = computed(() => labels[props.level] ?? props.level);

const onSelect = (next: ThinkingLevel) => {
  emit("select", next);
  open.value = false;
};

const close = () => {
  open.value = false;
};

const onDocPointerDown = (event: PointerEvent) => {
  if (!open.value) return;
  const target = event.target as Node;
  if (root.value?.contains(target)) return;
  if (target instanceof Element && target.closest(".thinking-selector__panel")) return;
  close();
};

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") close();
};

watch(open, async (next) => {
  if (next) {
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    await nextTick();
    updatePopoverPosition();
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", updatePopoverPosition);
    window.removeEventListener("scroll", updatePopoverPosition, true);
    popoverStyle.value = {};
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("resize", updatePopoverPosition);
  window.removeEventListener("scroll", updatePopoverPosition, true);
});
</script>

<template>
  <div ref="root" class="thinking-selector" :class="{ 'is-open': open }">
    <button
      type="button"
      class="thinking-selector__trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open = !open"
    >
      <AiGenerate2Icon class="thinking-selector__icon" />
      <span class="thinking-selector__label">{{ currentLabel }}</span>
      <ArrowDownSIcon class="thinking-selector__chevron" />
    </button>
    <Teleport v-if="open" to="body">
      <div class="thinking-selector__panel" role="listbox" :style="popoverStyle">
        <button
          v-for="level in visibleLevels"
          :key="level"
          type="button"
          class="thinking-selector__item"
          role="option"
          :aria-selected="level === props.level"
          :class="{ 'is-active': level === props.level }"
          @click="onSelect(level)"
        >
          <span>{{ labels[level] }}</span>
          <span class="thinking-selector__hint">{{ level }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.thinking-selector {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.thinking-selector__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 200px;
  height: 32px;
  padding: 0 8px 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #718d28;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.thinking-selector__trigger:hover {
  background: rgb(113 141 40 / 12%);
}
.thinking-selector__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}
.thinking-selector__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thinking-selector__chevron {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  opacity: 0.55;
}

/* Teleported to <body>; the scoped attribute rewrite keeps the matching
 * working. */
.thinking-selector__panel {
  z-index: 1000;
  display: flex;
  flex-direction: column;
  min-width: 156px;
  max-height: calc(100vh - 80px);
  overflow: hidden;
  border: 1px solid #e2dfd5;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  padding: 4px;
}
.thinking-selector__item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.thinking-selector__item:hover {
  background: rgb(0 0 0 / 5%);
}
.thinking-selector__item.is-active {
  background: rgb(113 141 40 / 14%);
  color: #4f631c;
}
.thinking-selector__hint {
  color: #999;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
