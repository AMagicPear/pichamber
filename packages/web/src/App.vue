<script setup lang="ts">
import { ref } from 'vue'
import { createSession, deleteSession, getEntries, listSessions } from './api/client'
import { connectWs, type WsHandle } from './api/ws'

const cwd = ref('/tmp')
const sessionId = ref<string | null>(null)
const promptText = ref('say hi briefly')
const ws = ref<WsHandle | null>(null)

// 全部结果打到控制台，UI 不显示
const log = (label: string, value: unknown) =>
  console.log(`[${label}]`, value)

async function onList() {
  log('GET /api/sessions', await listSessions())
}

async function onCreate() {
  const r = await createSession(cwd.value)
  sessionId.value = r.sessionId
  log('POST /api/sessions', r)
}

async function onGetEntries() {
  if (!sessionId.value) return console.warn('no sessionId')
  log(`GET /api/sessions/${sessionId.value}`, await getEntries(sessionId.value))
}

async function onDelete() {
  if (!sessionId.value) return console.warn('no sessionId')
  log(`DELETE /api/sessions/${sessionId.value}`, await deleteSession(sessionId.value))
  if (ws.value) {
    ws.value.close()
    ws.value = null
  }
  sessionId.value = null
}

function onConnect() {
  if (!sessionId.value) return console.warn('no sessionId')
  if (ws.value) ws.value.close()
  ws.value = connectWs(sessionId.value, (event) => log('ws event', event))
}

function onSend() {
  if (!ws.value) return console.warn('no ws')
  ws.value.send({ type: 'prompt', message: promptText.value })
}

function onCloseWs() {
  ws.value?.close()
  ws.value = null
}
</script>

<template>
  <h1>pichamber debug</h1>
  <p>所有操作结果打到浏览器控制台（DevTools / 终端）</p>

  <fieldset>
    <legend>REST</legend>
    <button @click="onList">list sessions</button>
    <input v-model="cwd" placeholder="cwd" />
    <button @click="onCreate">create session</button>
    <button @click="onGetEntries" :disabled="!sessionId">get entries</button>
    <button @click="onDelete" :disabled="!sessionId">delete session</button>
    <div>sessionId: {{ sessionId ?? '(none)' }}</div>
  </fieldset>

  <fieldset>
    <legend>WebSocket</legend>
    <button @click="onConnect" :disabled="!sessionId">connect</button>
    <button @click="onCloseWs" :disabled="!ws">close</button>
    <input v-model="promptText" placeholder="message" />
    <button @click="onSend" :disabled="!ws">send prompt</button>
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