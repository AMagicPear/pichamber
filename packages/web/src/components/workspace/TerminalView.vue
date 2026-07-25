<script setup lang="ts">
/**
 * TerminalView — one ghostty-web Terminal bound to one server-side PTY.
 *
 * Lifecycle follows the official ghostty-web demo pattern (see
 * https://github.com/coder/ghostty-web/blob/main/demo/index.html):
 *
 *   1. Mount: load WASM once via `useGhosttyInit()`, create Terminal +
 *      FitAddon, call `terminal.open(host)`, then `fitAddon.fit()` once and
 *      `fitAddon.observeResize()` for auto-fit on container changes.
 *   2. Parent already created the ptyId and passes it as a prop. On mount
 *      we open the WebSocket against that id.
 *   3. Bridge:
 *        - `terminal.onData`  → `ws.send` (keystrokes → shell stdin)
 *        - `terminal.onResize` → `ws.send({type:"resize", cols, rows})`
 *          (fires automatically when fitAddon fits a new size)
 *        - `ws.onmessage`      → `terminal.write` (stdout bytes)
 *   4. On `ws.onopen`, send one initial resize so the PTY matches the
 *      already-fitted terminal dimensions.
 *   5. Unmount: `terminal.dispose()` tears down the addon (which clears the
 *      ResizeObserver) and disconnects the WS; the server kills the PTY.
 *
 * Note: the parent provides the ptyId — this component does NOT call
 * startPty itself. Decoupling ptyId creation from mount keeps the :key
 * stable and prevents the double-mount that used to leak a phantom PTY.
 */

import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { FitAddon, Terminal, type Ghostty, type IDisposable } from "ghostty-web";
import { ptyWs } from "@/api/ws";
import { useGhosttyInit } from "@/composables/useGhostty";

const props = defineProps<{
  /** Server-assigned ptyId. The WebSocket is opened against this id. */
  ptyId: string;
}>();

const emit = defineEmits<{
  /** WS closed unexpectedly. */
  exited: [{ reason: string }];
}>();

const hostRef = useTemplateRef<HTMLDivElement>("hostRef");
const status = ref<"loading" | "connecting" | "ready" | "closed" | "error">("loading");
const errorMessage = ref<string>("");

let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let ws: WebSocket | undefined;
const disposers: IDisposable[] = [];

function teardown(): void {
  for (const d of disposers) d.dispose();
  disposers.length = 0;

  if (ws) {
    // Null handlers so an in-flight close doesn't double-fire status.
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = undefined;
  }

  if (terminal) {
    try {
      // Disposes the FitAddon too, which clears the ResizeObserver set up
      // by `fitAddon.observeResize()`.
      terminal.dispose();
    } catch {
      /* ignore */
    }
    terminal = undefined;
    fitAddon = undefined;
  }
}

async function ensureTerminal(): Promise<Terminal | null> {
  if (terminal) return terminal;
  if (!hostRef.value) return null;
  const host = hostRef.value;

  // 1) Load WASM (singleton — see useGhostty.ts).
  let ghostty: Ghostty;
  try {
    ghostty = await useGhosttyInit();
  } catch (err) {
    status.value = "error";
    errorMessage.value = err instanceof Error ? err.message : String(err);
    return null;
  }

  // 2) Pass the pre-loaded Ghostty instance so ghostty-web skips its own
  //    internal `init()` and the WASM bytes we already fetched get reused.
  const term = new Terminal({
    ghostty,
    cursorBlink: true,
    fontSize: 13,
    fontFamily:
      '"Maple Mono NF CN", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    theme: {
      background: "#171816",
      foreground: "#d6d7d2",
      cursor: "#d9a441",
      selectionBackground: "#4a4d47",
    },
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  // observeResize sets up a debounced ResizeObserver on terminal.element;
  // each fit it triggers fires terminal.onResize, which our handler below
  // forwards to the server.
  fit.observeResize();

  disposers.push(
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    }),
    term.onResize(({ cols, rows }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    }),
  );

  terminal = term;
  fitAddon = fit;
  return term;
}

function openSocket(ptyId: string): void {
  // Tear down any previous WS (e.g., after a re-spawn).
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = undefined;
  }

  ws = ptyWs(ptyId);

  ws.onopen = () => {
    // Send an initial resize so the server PTY matches the (potentially
    // re-fitted) terminal dimensions.
    if (terminal) {
      ws!.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    }
    if (status.value === "connecting") status.value = "ready";
  };

  ws.onmessage = (event) => {
    if (!terminal) return;
    if (typeof event.data === "string") {
      terminal.write(event.data);
    }
  };

  ws.onclose = (event) => {
    if (!terminal) return; // teardown raced us
    status.value = "closed";
    emit("exited", { reason: event.reason || `closed (${event.code})` });
  };

  ws.onerror = () => {
    if (!terminal) return;
    status.value = "error";
    errorMessage.value = "WebSocket connection failed";
  };
}

onBeforeUnmount(teardown);

onMounted(async () => {
  // The parent creates the ptyId before mounting us (it awaits startPty
  // before flipping the tab to status='ready'). At this point props.ptyId
  // is already the real server id.
  status.value = "connecting";
  const term = await ensureTerminal();
  if (!term || !props.ptyId) return;
  openSocket(props.ptyId);
});
</script>

<template>
  <div class="terminal-view">
    <div ref="hostRef" class="terminal-view__host" />
    <div
      v-if="
        status === 'loading' || status === 'connecting' || status === 'error' || status === 'closed'
      "
      class="terminal-view__overlay"
    >
      <p v-if="status === 'loading' || status === 'connecting'">Starting terminal…</p>
      <p v-else-if="status === 'error'">
        <strong>Terminal failed to start.</strong>
        <span>{{ errorMessage }}</span>
      </p>
      <p v-else>Terminal closed.</p>
    </div>
  </div>
</template>

<style scoped>
.terminal-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #171816;
}
.terminal-view__host {
  width: 100%;
  height: 100%;
  padding: 6px 8px;
  box-sizing: border-box;
}
.terminal-view__host :deep(canvas) {
  display: block;
}
.terminal-view__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: #888;
  font-size: 13px;
}
.terminal-view__overlay p {
  margin: 0;
}
.terminal-view__overlay strong {
  display: block;
  color: #d9a441;
}
.terminal-view__overlay span {
  display: block;
  margin-top: 4px;
  color: #888;
}
</style>
