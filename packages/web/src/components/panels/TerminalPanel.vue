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
 *   - The "maximize" button delegates panel geometry to the parent bottom
 *     SplitPane.
 *   - Tabs that the server has already torn down (status === "closed" with no
 *     restart prompt) auto-prune via the `onExited` handler.
 *
 * PTY lifecycle is explicit: closing a tab calls the server DELETE endpoint;
 * a disconnected WS only releases its subscription so HMR/reconnect can
 * reuse the same shell during the short server-side grace period.
 *
 * Styling intentionally mirrors the original TerminalPanel (light theme and
 * `#b65323` orange underline for the active tab).
 * The terminal canvas uses the same fixed light palette as the surrounding UI.
 */

import { computed, ref, watch } from "vue";
import AddIcon from "lucide-static/icons/plus.svg";
import CloseIcon from "lucide-static/icons/x.svg";
import FullscreenIcon from "lucide-static/icons/fullscreen.svg";
import FullscreenExitIcon from "lucide-static/icons/minimize.svg";
import TerminalIcon from "lucide-static/icons/terminal.svg";
import IconButton from "@/components/ui/IconButton.vue";
import TerminalView from "@/components/panels/TerminalView.vue";
import { startPty, stopPty, toMessage } from "@/api/client";
import { ui } from "@/stores/ui";
import { workspace } from "@/stores/workspace";

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

const bottomOpen = computed(() => ui.panels.bottom.open);

const tabs = ref<Tab[]>([]);
const activeId = ref<string | null>(null);
const maximized = computed(() => ui.maximized.bottom);

const focusTab = (id: string) => {
  activeId.value = id;
};

const createTab = async () => {
  // Optimistically add a tab so the user sees something immediately. The
  // tab starts with `ptyId: null`; on success we mutate the existing entry's
  // ptyId in place — the tab's `id` (used as Vue's :key) never changes, so
  // TerminalView doesn't unmount and we don't leak a phantom PTY.
  const localId = `local-${crypto.randomUUID()}`;
  const tab: Tab = {
    id: localId,
    ptyId: null,
    title: "Terminal",
    status: "creating",
    errorMessage: "",
  };
  tabs.value.push(tab);
  activeId.value = localId;

  try {
    // Start the shell in the session's workspace so the terminal tracks
    // the same cwd as the files/git panels (falls back to the server
    // workspace while no session is open).
    const result = await startPty({
      cols: 80,
      rows: 24,
      sessionId: workspace.sessionId ?? undefined,
    });
    const existing = tabs.value.find((t) => t.id === localId);
    if (!existing) {
      // The request can finish after the user closes the optimistic tab.
      // The WS was never opened, so explicitly release the server PTY.
      await stopPty(result.ptyId);
      return;
    }
    Object.assign(existing, {
      ptyId: result.ptyId,
      title: result.title === "~" ? "Terminal" : result.title,
      status: "ready" as const,
      errorMessage: "",
    });
  } catch (err) {
    const existing = tabs.value.find((t) => t.id === localId);
    if (!existing) return;
    Object.assign(existing, {
      title: "error",
      status: "error" as const,
      errorMessage: toMessage(err),
    });
  }
};

const closeTab = (id: string) => {
  const idx = tabs.value.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const ptyId = tabs.value[idx]!.ptyId;
  if (ptyId) {
    stopPty(ptyId).catch((error) => {
      console.error("Failed to stop terminal PTY", ptyId, error);
    });
  }
  const wasActive = activeId.value === id;
  tabs.value.splice(idx, 1);

  if (wasActive) {
    // Pick the previous tab, or the new right neighbour if we were leftmost.
    const next = tabs.value[idx - 1] ?? tabs.value[idx] ?? null;
    activeId.value = next?.id ?? null;
  }
};

const onTabExited = (id: string, payload: { reason: string }) => {
  const existing = tabs.value.find((t) => t.id === id);
  if (!existing) return;
  Object.assign(existing, {
    status: "closed",
    errorMessage: payload.reason,
  });
};

const reopenTab = async (id: string) => {
  // Drop the dead tab and start fresh.
  const idx = tabs.value.findIndex((t) => t.id === id);
  if (idx !== -1) tabs.value.splice(idx, 1);
  await createTab();
};

const toggleMaximize = () => {
  ui.toggleMaximized("bottom");
};

// Auto-create one tab the first time the panel becomes visible. Spawning a
// shell behind a closed panel would create a useless 0×0 PTY.
watch(
  bottomOpen,
  (open) => {
    if (open && tabs.value.length === 0) {
      createTab().catch((error) => {
        console.error("Failed to create terminal tab", error);
      });
    }
  },
  { immediate: true },
);

</script>

<template>
  <section class="terminal">
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
          <span class="terminal__tab-icon-wrap">
            <TerminalIcon class="terminal__tab-icon" />
            <IconButton
              class="terminal__tab-icon-close"
              size="mini"
              label="Close terminal tab"
              @click.stop="closeTab(tab.id)"
            >
              <CloseIcon />
            </IconButton>
          </span>
          <span class="terminal__tab-title">{{ tab.title }}</span>
        </div>
        <IconButton size="compact" label="New terminal" @click="createTab">
          <AddIcon />
        </IconButton>
      </div>
      <div class="terminal__actions">
        <IconButton
          size="compact"
          :label="maximized ? 'Restore terminal' : 'Maximize terminal'"
          :pressed="maximized"
          @click="toggleMaximize"
        >
          <FullscreenExitIcon v-if="maximized" />
          <FullscreenIcon v-else />
        </IconButton>
        <IconButton
          size="compact"
          label="Close terminal panel"
          @click="ui.toggle('bottom')"
        >
          <CloseIcon />
        </IconButton>
      </div>
    </header>

    <div class="terminal__body">
      <template v-if="tabs.length === 0">
        <div class="terminal__empty">
          <p>No terminals yet.</p>
          <button type="button" class="ui-empty-action" @click="createTab">
            <AddIcon />
            <span>New terminal</span>
          </button>
        </div>
      </template>
      <template v-else>
        <div v-for="tab in tabs" v-show="tab.id === activeId" :key="tab.id" class="terminal__pane">
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
          <div v-else-if="tab.status === 'error'" class="terminal__state terminal__state--error">
            <p>
              <strong>Terminal failed to start.</strong>
              <span>{{ tab.errorMessage }}</span>
            </p>
            <button type="button" class="terminal__action" @click="reopenTab(tab.id)">
              Try again
            </button>
          </div>
          <div v-else class="terminal__state">
            <p>
              <strong>Terminal closed.</strong>
              <span>{{ tab.errorMessage || "Shell exited." }}</span>
            </p>
            <button type="button" class="terminal__action" @click="reopenTab(tab.id)">
              Restart
            </button>
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
  background: var(--ui-surface);
  color: var(--ui-text);
}

/* ── Header ────────────────────────────────────────────────────────── */
/* The orange active-tab underline sits on the header's bottom edge. */
.terminal__header {
  display: flex;
  flex: 0 0 30px;
  align-items: stretch;
  justify-content: space-between;
  padding: 0 6px 0 12px;
  font-size: 14px;
}

/* ── Tab strip ─────────────────────────────────────────────────────── */
.terminal__tabs {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: stretch;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.terminal__tabs::-webkit-scrollbar {
  display: none;
}

.terminal__tab {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 8px;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
  transition: color 120ms ease;
}
.terminal__tab:hover {
  color: var(--ui-text-strong);
}
.terminal__tab:focus-visible {
  outline: 2px solid #b65323;
  outline-offset: -2px;
}
.terminal__tab.is-active {
  color: var(--ui-text-strong);
}
.terminal__tab.is-active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 3px;
  border-radius: 2px 2px 0 0;
  background: #b65323;
  content: "";
}
.terminal__tab-icon {
  width: 16px;
  height: 16px;
  color: var(--ui-text-muted);
  transition: opacity 120ms ease;
}
.terminal__tab.is-active .terminal__tab-icon {
  color: #b65323;
}
.terminal__tab-icon-wrap {
  position: relative;
  display: inline-flex;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.terminal__tab-icon-close {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 120ms ease;
}
.terminal__tab:hover .terminal__tab-icon {
  opacity: 0;
}
.terminal__tab:hover .terminal__tab-icon-close {
  opacity: 1;
}
.terminal__tab-title {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
/* ── Header actions (maximize / close-panel) ───────────────────────── */
.terminal__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}

/* ── Body ──────────────────────────────────────────────────────────── */
.terminal__body {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  background: var(--ui-surface);
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
  color: var(--ui-text-muted);
  font-size: 13px;
}
.terminal__action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-surface);
  color: var(--ui-text-strong);
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 1px 2px rgb(16 15 15 / 4%);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease,
    color 120ms ease;
}
.terminal__action :deep(svg) {
  width: 14px;
  height: 14px;
  color: #b65323;
}
.terminal__action:hover {
  border-color: #b65323;
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}
.terminal__action:focus-visible {
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
  color: var(--ui-text-muted);
}
.terminal__empty p,
.terminal__state p {
  margin: 0;
}

/* ── Maximize ──────────────────────────────────────────────────────── */
</style>
