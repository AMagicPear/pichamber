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
 *      ResizeObserver) and disconnects the WS. The PTY is owned by its tab;
 *      explicit tab close calls the server DELETE endpoint.
 *
 * Note: the parent provides the ptyId — this component does NOT call
 * startPty itself. Decoupling ptyId creation from mount keeps the :key
 * stable and prevents the double-mount that used to leak a phantom PTY.
 */

import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { FitAddon, Terminal, type Ghostty, type IDisposable } from "ghostty-web";
import { ptyWs } from "@/api/ws";
import { useGhosttyInit } from "@/composables/useGhostty";
import { releaseTerminalCleanup, replaceTerminalCleanup } from "@/composables/terminalRegistry";

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
let ws: WebSocket | undefined;
const disposers: IDisposable[] = [];
let registeredHost: HTMLElement | undefined;
let disposed = false;
let pendingOutput = "";
let outputFrame: number | undefined;
let outputWriting = false;

function flushOutput(): void {
  outputFrame = undefined;
  if (outputWriting || !terminal || !pendingOutput) return;

  const data = pendingOutput;
  pendingOutput = "";
  outputWriting = true;
  terminal.write(data, () => {
    outputWriting = false;
    if (pendingOutput) scheduleOutputFlush();
  });
}

function scheduleOutputFlush(): void {
  if (outputFrame !== undefined) return;
  outputFrame = window.requestAnimationFrame(flushOutput);
}

function enqueueOutput(data: string): void {
  pendingOutput += data;
  scheduleOutputFlush();
}

function resetOutputQueue(): void {
  pendingOutput = "";
  outputWriting = false;
  if (outputFrame !== undefined) {
    window.cancelAnimationFrame(outputFrame);
    outputFrame = undefined;
  }
}

function teardown(): void {
  disposed = true;
  resetOutputQueue();

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
      // Terminal disposal also disposes the FitAddon and its ResizeObserver.
      terminal.dispose();
    } catch {
      /* ignore */
    }
    terminal = undefined;
  }

  if (registeredHost) {
    releaseTerminalCleanup(registeredHost, teardown);
    registeredHost = undefined;
  }
}

async function ensureTerminal(): Promise<Terminal | null> {
  if (disposed || terminal) return terminal ?? null;
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
  if (disposed || hostRef.value !== host) return null;

  // 2) Pass the pre-loaded Ghostty instance so ghostty-web skips its own
  //    internal `init()` and the WASM bytes we already fetched get reused.
  const term = new Terminal({
    ghostty,
    cursorBlink: true,
    fontSize: 13,
    fontFamily:
      '"Maple Mono NF CN", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    theme: {
      background: "#fffdf4",
      foreground: "#100f0f",
      cursor: "#100f0f",
      cursorAccent: "#fffdf4",
      selectionBackground: "#76736f30",
      selectionForeground: "#100f0f",
      black: "#100f0f",
      red: "#af3029",
      green: "#66800b",
      yellow: "#bc5215",
      blue: "#205ea6",
      magenta: "#5e409d",
      cyan: "#24837b",
      white: "#fffdf4",
      brightBlack: "#6f6e69",
      brightRed: "#af3029",
      brightGreen: "#66800b",
      brightYellow: "#bc5215",
      brightBlue: "#205ea6",
      brightMagenta: "#5e409d",
      brightCyan: "#24837b",
      brightWhite: "#fffdf4",
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
  registeredHost = host;
  replaceTerminalCleanup(host, teardown);
  return term;
}

function closeSocket(): void {
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
}

function openSocket(ptyId: string): void {
  closeSocket();

  const socket = ptyWs(ptyId);
  ws = socket;

  socket.onopen = () => {
    // Send an initial resize so the server PTY matches the (potentially
    // re-fitted) terminal dimensions.
    if (terminal) {
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    }
    if (status.value === "connecting") status.value = "ready";
  };

  socket.onmessage = (event) => {
    if (!terminal) return;
    if (typeof event.data === "string") {
      enqueueOutput(event.data);
    }
  };

  socket.onclose = (event) => {
    if (!terminal) return; // teardown raced us
    status.value = "closed";
    emit("exited", { reason: event.reason || `closed (${event.code})` });
  };

  socket.onerror = () => {
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
  if (!term || disposed || !props.ptyId) return;
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
  background: #fffdf4;
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
  color: #bc5215;
}
.terminal-view__overlay span {
  display: block;
  margin-top: 4px;
  color: #888;
}
</style>
