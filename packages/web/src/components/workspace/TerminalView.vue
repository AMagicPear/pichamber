<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { FitAddon, Terminal, type Ghostty, type IDisposable } from "ghostty-web";
import { ptyWs } from "@/api/ws";
import { useGhosttyInit } from "@/composables/useGhostty";
import { releaseTerminalCleanup, replaceTerminalCleanup } from "@/composables/terminalRegistry";

const props = defineProps<{ ptyId: string }>();
const emit = defineEmits<{ exited: [{ reason: string }] }>();

const hostRef = useTemplateRef<HTMLDivElement>("hostRef");
const status = ref<"loading" | "connecting" | "ready" | "closed" | "error">("loading");
const errorMessage = ref("");

const disposers: IDisposable[] = [];
let terminal: Terminal | undefined;
let socket: WebSocket | undefined;
let registeredHost: HTMLElement | undefined;
let disposed = false;
let pendingOutput = "";
let outputFrame: number | undefined;
let outputWriting = false;

const terminalTheme = {
  background: "#ffffff",
  foreground: "#1f1f1f",
  cursor: "#1f1f1f",
  cursorAccent: "#ffffff",
  selectionBackground: "#d9d9d9",
};

function flushOutput(): void {
  outputFrame = undefined;
  if (outputWriting || !terminal || !pendingOutput) return;

  const data = pendingOutput;
  pendingOutput = "";
  outputWriting = true;
  terminal.write(data, () => {
    outputWriting = false;
    if (pendingOutput) scheduleOutput();
  });
}

function scheduleOutput(): void {
  if (outputFrame === undefined) outputFrame = window.requestAnimationFrame(flushOutput);
}

function enqueueOutput(data: string): void {
  pendingOutput += data;
  scheduleOutput();
}

function closeSocket(): void {
  const current = socket;
  socket = undefined;
  if (!current) return;
  current.onopen = null;
  current.onmessage = null;
  current.onerror = null;
  current.onclose = null;
  if (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING) {
    current.close();
  }
}

function teardown(): void {
  disposed = true;
  pendingOutput = "";
  outputWriting = false;
  if (outputFrame !== undefined) {
    window.cancelAnimationFrame(outputFrame);
    outputFrame = undefined;
  }
  for (const disposer of disposers) disposer.dispose();
  disposers.length = 0;
  closeSocket();
  terminal?.dispose();
  terminal = undefined;
  if (registeredHost) {
    releaseTerminalCleanup(registeredHost, teardown);
    registeredHost = undefined;
  }
}

async function createTerminal(): Promise<Terminal | null> {
  const host = hostRef.value;
  if (!host || disposed || terminal) return terminal ?? null;

  let ghostty: Ghostty;
  try {
    ghostty = await useGhosttyInit();
  } catch (error) {
    status.value = "error";
    errorMessage.value = error instanceof Error ? error.message : String(error);
    return null;
  }
  if (disposed || hostRef.value !== host) return null;

  const term = new Terminal({
    ghostty,
    cursorBlink: false,
    cursorStyle: "bar",
    fontSize: 13,
    fontFamily:
      '"Maple Mono NF CN", "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    theme: terminalTheme,
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  fit.observeResize();

  disposers.push(
    term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data);
    }),
    term.onResize(({ cols, rows }) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    }),
  );

  terminal = term;
  registeredHost = host;
  replaceTerminalCleanup(host, teardown);
  return term;
}

function connect(): void {
  closeSocket();
  const current = ptyWs(props.ptyId);
  socket = current;

  current.onopen = () => {
    if (terminal) {
      current.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
    }
    status.value = "ready";
  };
  current.onmessage = (event) => {
    if (typeof event.data === "string") enqueueOutput(event.data);
  };
  current.onerror = () => {
    if (disposed) return;
    status.value = "error";
    errorMessage.value = "WebSocket connection failed";
  };
  current.onclose = (event) => {
    if (disposed) return;
    status.value = "closed";
    emit("exited", { reason: event.reason || `closed (${event.code})` });
  };
}

onMounted(async () => {
  status.value = "connecting";
  const term = await createTerminal();
  if (term && props.ptyId && !disposed) connect();
});

onBeforeUnmount(teardown);
</script>

<template>
  <div class="terminal-view">
    <div ref="hostRef" class="terminal-view__host" />
    <div v-if="status !== 'ready'" class="terminal-view__overlay">
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
  background: #ffffff;
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
.terminal-view__host :deep(textarea) {
  caret-color: transparent !important;
}
.terminal-view__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: #686663;
  font-size: 13px;
}
.terminal-view__overlay p {
  margin: 0;
}
.terminal-view__overlay strong {
  display: block;
  color: #555555;
}
.terminal-view__overlay span {
  display: block;
  margin-top: 4px;
  color: #686663;
}
</style>
