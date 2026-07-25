<script setup lang="ts">
/**
 * TerminalPanel — multi-tab terminal dock backed by ghostty-web.
 *
 * State model:
 *   - `tabs` is the canonical list of shells the user has opened. Each tab
 *     owns a server-side PTY identified by `ptyId`. The active tab is `activeId`.
 *   - "+" creates a new tab with a fresh PTY.
 *   - "×" on a tab kills its PTY and removes the tab. Killing the active tab
 *     focuses the previous one (or the next, if it was the leftmost).
 *   - The "maximize" button toggles a class on the panel so CSS can expand it
 *     to fill the workspace body, hiding the conversation above it.
 *   - Tabs that the server has already torn down (status === "closed" with no
 *     restart prompt) auto-prune via the `onExited` handler.
 *
 * PTY lifecycle is explicit: closing a tab calls the server DELETE endpoint;
 * a disconnected WS only releases its subscription so HMR/reconnect can
 * reuse the same shell during the short server-side grace period.
 *
 * Styling intentionally mirrors the original TerminalPanel (light theme,
 * `#dedbd2` header border, `#b65323` orange underline for the active tab).
 * The terminal canvas uses the same fixed light palette as the surrounding UI.
 */

import { computed, ref, watch } from "vue";
import AddIcon from "@/assets/icons/Add.svg";
import CloseIcon from "@/assets/icons/Close.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import FullscreenExitIcon from "@/assets/icons/FullscreenExit.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
import PanelToggleButton from "@/components/PanelToggleButton.vue";
import IconButton from "@/components/IconButton.vue";
import TerminalView from "@/components/workspace/TerminalView.vue";
import { startPty, stopPty } from "@/api/client";
import { useUiStore } from "@/stores/ui";

type TabStatus = "creating" | "ready" | "closed" | "error";

interface Tab {
  /**
   * Stable local id, used as Vue's `:key` so the TerminalView doesn't
   * unmount when the server-assigned ptyId arrives. Keeping this constant
   * prevents the double-mount that would otherwise spawn an extra PTY.
   */
  id: string;
  /** Server-assigned ptyId; null until startPty() resolves. */
  ptyId: string | null;
  title: string;
  status: TabStatus;
  errorMessage: string;
}

const ui = useUiStore();
const bottomOpen = computed(() => ui.panels.bottom.open);

const tabs = ref<Tab[]>([]);
const activeId = ref<string | null>(null);
const maximized = ref(false);

function focusTab(id: string): void {
  activeId.value = id;
}

async function createTab(): Promise<void> {
  // Optimistically add a tab so the user sees something immediately. The
  // tab starts with `ptyId: null`; on success we mutate the existing entry's
  // ptyId in place — the tab's `id` (used as Vue's :key) never changes, so
  // TerminalView doesn't unmount and we don't leak a phantom PTY.
  const localId = `local-${crypto.randomUUID()}`;
  const tab: Tab = {
    id: localId,
    ptyId: null,
    title: "…",
    status: "creating",
    errorMessage: "",
  };
  tabs.value.push(tab);
  activeId.value = localId;

  try {
    const result = await startPty({ cols: 80, rows: 24 });
    const existing = tabs.value.find((t) => t.id === localId);
    if (!existing) {
      // The request can finish after the user closes the optimistic tab.
      // The WS was never opened, so explicitly release the server PTY.
      await stopPty(result.ptyId);
      return;
    }
    Object.assign(existing, {
      ptyId: result.ptyId,
      title: result.title,
      status: "ready" as const,
      errorMessage: "",
    });
  } catch (err) {
    const existing = tabs.value.find((t) => t.id === localId);
    if (!existing) return;
    Object.assign(existing, {
      title: "error",
      status: "error" as const,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

function closeTab(id: string): void {
  const idx = tabs.value.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const ptyId = tabs.value[idx]!.ptyId;
  if (ptyId) void stopPty(ptyId);
  const wasActive = activeId.value === id;
  tabs.value.splice(idx, 1);

  if (wasActive) {
    // Pick the previous tab, or the new right neighbour if we were leftmost.
    const next = tabs.value[idx - 1] ?? tabs.value[idx] ?? null;
    activeId.value = next?.id ?? null;
  }
}

function onTabExited(id: string, payload: { reason: string }): void {
  const existing = tabs.value.find((t) => t.id === id);
  if (!existing) return;
  Object.assign(existing, {
    status: "closed",
    errorMessage: payload.reason,
  });
}

async function reopenTab(id: string): Promise<void> {
  // Drop the dead tab and start fresh.
  const idx = tabs.value.findIndex((t) => t.id === id);
  if (idx !== -1) tabs.value.splice(idx, 1);
  await createTab();
}

function toggleMaximize(): void {
  maximized.value = !maximized.value;
}

// Auto-create one tab the first time the panel becomes visible. Spawning a
// shell behind a closed panel would create a useless 0×0 PTY.
watch(
  bottomOpen,
  (open) => {
    if (open && tabs.value.length === 0) void createTab();
  },
  { immediate: true },
);

// Reset maximize when the panel closes so re-opening at full screen is
// never surprising.
watch(bottomOpen, (open) => {
  if (!open) maximized.value = false;
});
</script>

<template>
  <section class="terminal" :class="{ 'is-maximized': maximized }">
    <header class="terminal__header">
      <div class="terminal__tabs" role="tablist">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          role="tab"
          tabindex="0"
          :aria-selected="tab.id === activeId"
          :class="['terminal__tab', { 'is-active': tab.id === activeId }]"
          @click="focusTab(tab.id)"
          @keydown.enter.prevent="focusTab(tab.id)"
          @keydown.space.prevent="focusTab(tab.id)"
          @auxclick="(e) => e.button === 1 && closeTab(tab.id)"
          @dblclick="closeTab(tab.id)"
        >
          <TerminalIcon class="terminal__tab-icon" />
          <span class="terminal__tab-title">{{ tab.title }}</span>
          <button
            type="button"
            class="terminal__tab-close"
            aria-label="Close terminal tab"
            @click.stop="closeTab(tab.id)"
          >
            <CloseIcon />
          </button>
        </div>
        <button
          type="button"
          class="terminal__new"
          aria-label="New terminal"
          title="New terminal"
          @click="createTab"
        >
          <AddIcon />
        </button>
      </div>
      <div class="terminal__actions">
        <IconButton
          size="compact"
          :label="maximized ? 'Restore terminal' : 'Maximize terminal'"
          @click="toggleMaximize"
        >
          <FullscreenExitIcon v-if="maximized" />
          <FullscreenIcon v-else />
        </IconButton>
        <PanelToggleButton size="compact" panel="bottom" label="Close terminal panel">
          <CloseIcon />
        </PanelToggleButton>
      </div>
    </header>

    <div class="terminal__body">
      <template v-if="tabs.length === 0">
        <div class="terminal__empty">
          <p>No terminals yet.</p>
          <button type="button" class="terminal__empty-action" @click="createTab">
            <AddIcon />
            <span>New terminal</span>
          </button>
        </div>
      </template>
      <template v-else>
        <div
          v-for="tab in tabs"
          v-show="tab.id === activeId"
          :key="tab.id"
          class="terminal__pane"
        >
          <!-- The local id stays stable while the server ptyId is assigned. -->
          <TerminalView
            v-if="(tab.status === 'ready' || tab.status === 'creating') && tab.ptyId"
            :key="tab.id"
            :pty-id="tab.ptyId"
            @exited="(p) => onTabExited(tab.id, p)"
          />
          <div v-else-if="tab.status === 'creating'" class="terminal__state">
            <p>Starting shell…</p>
          </div>
          <div
            v-else-if="tab.status === 'error'"
            class="terminal__state terminal__state--error"
          >
            <p>
              <strong>Terminal failed to start.</strong>
              <span>{{ tab.errorMessage }}</span>
            </p>
            <button type="button" @click="reopenTab(tab.id)">Try again</button>
          </div>
          <div v-else class="terminal__state">
            <p>
              <strong>Terminal closed.</strong>
              <span>{{ tab.errorMessage || "Shell exited." }}</span>
            </p>
            <button type="button" @click="reopenTab(tab.id)">Restart</button>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* ── Layout shell ──────────────────────────────────────────────────── */
.terminal {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #ffffff;
  color: #171717;
}

/* ── Header ────────────────────────────────────────────────────────── */
/* Mirrors the original TerminalPanel: 34px tall, 12px horizontal padding,
   #dedbd2 bottom border, 14px font-size. The orange active-tab underline
   sits on top of the header's bottom border. */
.terminal__header {
  display: flex;
  flex: 0 0 34px;
  align-items: stretch;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid #dedbd2;
  font-size: 14px;
}

/* ── Tab strip ─────────────────────────────────────────────────────── */
.terminal__tabs {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: stretch;
  gap: 14px;
  overflow-x: auto;
  scrollbar-width: none;
}
.terminal__tabs::-webkit-scrollbar {
  display: none;
}

/* Each tab fills the header's 34px and aligns an icon + title + close button
   on a single row, matching the original's 7px gap and 16×16 icon size. The
   2px transparent border-bottom becomes the orange accent for the active
   tab. */
.terminal__tab {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 4px 0 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #777;
  cursor: pointer;
  transition: color 120ms ease;
}
.terminal__tab:hover {
  color: #171717;
}
.terminal__tab:focus-visible {
  outline: 2px solid #b65323;
  outline-offset: -2px;
}
.terminal__tab.is-active {
  color: #171717;
  border-bottom-color: #b65323;
}
.terminal__tab-icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  color: inherit;
}
.terminal__tab-title {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.terminal__tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: #888;
  opacity: 0;
  transition: opacity 120ms ease;
}
.terminal__tab-close :deep(svg) {
  width: 12px;
  height: 12px;
}
.terminal__tab:hover .terminal__tab-close,
.terminal__tab.is-active .terminal__tab-close {
  opacity: 1;
}
.terminal__tab-close:hover {
  background: rgb(0 0 0 / 6%);
  color: #171717;
}

/* ── "+ new tab" affordance ────────────────────────────────────────── */
.terminal__new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: #777;
  flex: 0 0 auto;
}
.terminal__new :deep(svg) {
  width: 14px;
  height: 14px;
}
.terminal__new:hover {
  background: rgb(0 0 0 / 5%);
  color: #171717;
}

/* ── Header actions (maximize / close-panel) ───────────────────────── */
.terminal__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
}

/* ── Body ──────────────────────────────────────────────────────────── */
.terminal__body {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  background: #ffffff;
}
.terminal__pane {
  position: absolute;
  inset: 0;
}

/* ── Empty / error states ──────────────────────────────────────────── */
.terminal__empty,
.terminal__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: #777;
  font-size: 13px;
}
.terminal__state button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid #dedbd2;
  border-radius: 6px;
  background: #ffffff;
  color: #171717;
  font-size: 13px;
}
.terminal__state button:hover {
  background: #f6f5f0;
}
.terminal__empty-action {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #dad8ce;
  border-radius: 4px;
  background: #ffffff;
  color: #333230;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 1px 2px rgb(16 15 15 / 4%);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    color 120ms ease;
}
.terminal__empty-action :deep(svg) {
  width: 14px;
  height: 14px;
  color: #b65323;
}
.terminal__empty-action:hover {
  border-color: #b65323;
  background: #fffaf5;
  color: #171717;
}
.terminal__empty-action:focus-visible {
  outline: 2px solid #b65323;
  outline-offset: 2px;
}
.terminal__state strong {
  color: #b65323;
}
.terminal__state--error strong {
  color: #b43232;
}
.terminal__state span {
  display: block;
  margin-top: 4px;
  color: #888;
}
.terminal__empty p,
.terminal__state p {
  margin: 0;
}

/* ── Maximize ──────────────────────────────────────────────────────── */
/* Fill the workspace body, hiding the conversation panel above. We use
   position:fixed so we escape any ancestor with overflow:hidden (the
   SplitPane chains). */
.terminal.is-maximized {
  position: fixed;
  inset: 9px 9px 9px 9px;
  z-index: 50;
  border-radius: 10px;
  border: 1px solid #dedbd2;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}
</style>
