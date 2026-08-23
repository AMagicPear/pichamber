<script setup lang="ts">
import { ref, watch } from "vue";
import type { PiBehaviorSettings } from "@amagicpear/pichamber-shared";
import { fetchPiBehavior, toMessage, updatePiBehavior } from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";
import SettingsPageHeader from "./SettingsPageHeader.vue";

const behavior = ref<PiBehaviorSettings | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const load = async () => {
  const sessionId = workspace.sessionId;
  behavior.value = null;
  error.value = null;
  if (!sessionId) return;
  loading.value = true;
  try {
    behavior.value = await fetchPiBehavior(sessionId);
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const save = async (update: Partial<PiBehaviorSettings>) => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  saving.value = true;
  error.value = null;
  try {
    const result = await updatePiBehavior(sessionId, update);
    if (result.reload) {
      window.location.reload();
      return;
    }
    behavior.value = result;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const saveIdleTimeout = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isInteger(value) && value >= 0) void save({ httpIdleTimeoutMs: value });
};


watch(() => workspace.sessionId, load, { immediate: true });
</script>

<template>
  <SettingsPageHeader title="Behavior" description="Control how Pi compacts context, retries requests, and delivers queued work." />

  <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="behavior-settings__state">Loading behavior settings…</p>

  <template v-else-if="behavior">
    <SettingsGroup title="Agent lifecycle">
      <SettingsOption title="Automatic compaction" description="Compact context before it reaches the model limit.">
        <input :checked="behavior.autoCompaction" type="checkbox" :disabled="saving" @change="save({ autoCompaction: ($event.target as HTMLInputElement).checked })" />
      </SettingsOption>
      <SettingsOption title="Retry transient failures" description="Retry eligible provider failures with Pi's configured backoff.">
        <input :checked="behavior.autoRetry" type="checkbox" :disabled="saving" @change="save({ autoRetry: ($event.target as HTMLInputElement).checked })" />
      </SettingsOption>
    </SettingsGroup>

    <SettingsGroup title="Message delivery" class="behavior-settings__section">
      <SettingsOption inline title="Steering mode" description="Deliver queued steering messages together or one per turn.">
        <select :value="behavior.steeringMode" :disabled="saving" @change="save({ steeringMode: ($event.target as HTMLSelectElement).value as PiBehaviorSettings['steeringMode'] })"><option value="one-at-a-time">One at a time</option><option value="all">All at once</option></select>
      </SettingsOption>
      <SettingsOption inline title="Follow-up mode" description="Deliver queued follow-ups together or one per completed run.">
        <select :value="behavior.followUpMode" :disabled="saving" @change="save({ followUpMode: ($event.target as HTMLSelectElement).value as PiBehaviorSettings['followUpMode'] })"><option value="one-at-a-time">One at a time</option><option value="all">All at once</option></select>
      </SettingsOption>
    </SettingsGroup>

    <SettingsGroup title="Transport" class="behavior-settings__section">
      <SettingsOption inline title="Provider transport" description="Prefer a stream transport when the provider supports more than one.">
        <select :value="behavior.transport" :disabled="saving" @change="save({ transport: ($event.target as HTMLSelectElement).value as PiBehaviorSettings['transport'] })"><option value="auto">Automatic</option><option value="sse">Server-sent events</option><option value="websocket">WebSocket</option><option value="websocket-cached">Cached WebSocket</option></select>
      </SettingsOption>
      <SettingsOption inline title="HTTP idle timeout" description="Milliseconds to wait without provider response. Set 0 to disable.">
        <input :value="behavior.httpIdleTimeoutMs" type="number" min="0" step="1000" :disabled="saving" @change="saveIdleTimeout" />
      </SettingsOption>
    </SettingsGroup>
  </template>
</template>

<style scoped>
.behavior-settings__state { margin: 20px 0; color: var(--ui-text-muted); font-size: 13px; }
.behavior-settings__section { margin-top: 28px; }
</style>
