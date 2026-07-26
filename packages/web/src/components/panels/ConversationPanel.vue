<script setup lang="ts">
import { createSession, getEntries, listSessions, toMessage } from "@/api/client";
import ConversationComposer from "@/components/workspace/ConversationComposer.vue";
import type { SessionEntry } from "@pichamber/shared";
import { ref, watch } from "vue";

const props = defineProps<{
  sessionId?: string | null;
}>();

const entries = ref<SessionEntry[]>([]);
const loading = ref(false);
const error = ref<string>();

const log = (label: string, value: unknown) => console.log(`[${label}]`, value);

const ensureSession = async () => {
  const sessions = await listSessions();
  const existing = sessions[0];
  if (existing) return existing.id;
  const created = await createSession(".");
  return created.sessionId;
};

let loadVersion = 0;

const load = async () => {
  const version = ++loadVersion;
  loading.value = true;
  error.value = undefined;
  try {
    const id = props.sessionId ?? (await ensureSession());
    const snapshot = await getEntries(id);
    if (version !== loadVersion) return;
    entries.value = snapshot.entries;
    log(`GET /api/sessions/${id}`, snapshot);
  } catch (err) {
    if (version === loadVersion) error.value = toMessage(err);
  } finally {
    if (version === loadVersion) loading.value = false;
  }
};
</script>

<template>
  <main>
    <p v-if="loading">Loading session...</p>
    <p v-else-if="error">{{ error }}</p>
    <template v-else-if="entries.length > 0">
      <pre v-for="entry in entries" :key="entry.id">{{ JSON.stringify(entry, null, 2) }}</pre>
    </template>
    <p v-else>No entries.</p>

    <ConversationComposer disabled />
  </main>
</template>
