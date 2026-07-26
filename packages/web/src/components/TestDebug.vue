<script setup lang="ts">
import { ref } from "vue";
import { createSession, deleteSession, getEntries, listSessions } from "../api/client";
import { connectSessionWs, type WsHandle } from "../api/ws";

const cwd = ref("/tmp");
const sessionId = ref<string | null>(null);
const promptText = ref("say hi briefly");
const ws = ref<WsHandle | null>(null);

// All results are written to the browser console; the debug surface stays minimal.
const log = (label: string, value: unknown) => console.log(`[${label}]`, value);

const onList = async () => {
  log("GET /api/sessions", await listSessions());
};

const onCreate = async () => {
  const result = await createSession(cwd.value);
  sessionId.value = result.sessionId;
  log("POST /api/sessions", result);
};

const onGetEntries = async () => {
  if (!sessionId.value) return console.warn("no sessionId");
  log(`GET /api/sessions/${sessionId.value}`, await getEntries(sessionId.value));
};

const onDelete = async () => {
  if (!sessionId.value) return console.warn("no sessionId");
  log(`DELETE /api/sessions/${sessionId.value}`, await deleteSession(sessionId.value));
  ws.value?.close();
  ws.value = null;
  sessionId.value = null;
};

const onConnect = () => {
  if (!sessionId.value) return console.warn("no sessionId");
  ws.value?.close();
  ws.value = connectSessionWs(sessionId.value, (event) => log("ws event", event));
}

const onSend = () => {
  if (!ws.value) return console.warn("no ws");
  ws.value.send({ type: "prompt", message: promptText.value });
};

const onCloseWs = () => {
  ws.value?.close();
  ws.value = null;
};
</script>

<template>
  <h1>pichamber debug</h1>
  <p>所有操作结果打到浏览器控制台（DevTools / 终端）</p>

  <fieldset>
    <legend>REST</legend>
    <button @click="onList">list sessions</button>
    <input v-model="cwd" placeholder="cwd" />
    <button @click="onCreate">create session</button>
    <button :disabled="!sessionId" @click="onGetEntries">get entries</button>
    <button :disabled="!sessionId" @click="onDelete">delete session</button>
    <div>sessionId: {{ sessionId ?? "(none)" }}</div>
  </fieldset>

  <fieldset>
    <legend>WebSocket</legend>
    <button :disabled="!sessionId" @click="onConnect">connect</button>
    <button :disabled="!ws" @click="onCloseWs">close</button>
    <input v-model="promptText" placeholder="message" />
    <button :disabled="!ws" @click="onSend">send prompt</button>
  </fieldset>
</template>

<style scoped>
fieldset {
  margin: 8px 0;
  padding: 8px;
}
input {
  margin: 0 4px;
}
button {
  margin: 0 4px;
}
</style>
