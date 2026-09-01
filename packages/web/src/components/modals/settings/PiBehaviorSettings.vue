<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { PiBehaviorSettings } from "@amagicpear/pichamber-shared";
import { fetchPiBehavior, toMessage, updatePiBehavior } from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";
import SettingsSelect from "./SettingsSelect.vue";
import SettingsPageHeader from "./SettingsPageHeader.vue";

const { t } = useI18n();

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
  <SettingsPageHeader :title="t('settings.behavior.title')" :description="t('settings.behavior.description')" />

  <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="behavior-settings__state">{{ t('settings.behavior.loading') }}</p>

  <template v-else-if="behavior">
    <SettingsGroup :title="t('settings.behavior.agentLifecycle')">
      <SettingsOption :title="t('settings.behavior.automaticCompaction')" :description="t('settings.behavior.automaticCompactionDesc')">
        <input :checked="behavior.autoCompaction" type="checkbox" :disabled="saving" @change="save({ autoCompaction: ($event.target as HTMLInputElement).checked })" />
      </SettingsOption>
      <SettingsOption :title="t('settings.behavior.retryTransient')" :description="t('settings.behavior.retryTransientDesc')">
        <input :checked="behavior.autoRetry" type="checkbox" :disabled="saving" @change="save({ autoRetry: ($event.target as HTMLInputElement).checked })" />
      </SettingsOption>
    </SettingsGroup>

    <SettingsGroup :title="t('settings.behavior.messageDelivery')" class="behavior-settings__section">
      <SettingsOption inline :title="t('settings.behavior.steeringMode')" :description="t('settings.behavior.steeringModeDesc')">
        <SettingsSelect :value="behavior.steeringMode" :disabled="saving" @change="save({ steeringMode: ($event.target as HTMLSelectElement).value as PiBehaviorSettings['steeringMode'] })"><option value="one-at-a-time">{{ t('settings.behavior.oneAtATime') }}</option><option value="all">{{ t('settings.behavior.allAtOnce') }}</option></SettingsSelect>
      </SettingsOption>
      <SettingsOption inline :title="t('settings.behavior.followUpMode')" :description="t('settings.behavior.followUpModeDesc')">
        <SettingsSelect :value="behavior.followUpMode" :disabled="saving" @change="save({ followUpMode: ($event.target as HTMLSelectElement).value as PiBehaviorSettings['followUpMode'] })"><option value="one-at-a-time">{{ t('settings.behavior.oneAtATime') }}</option><option value="all">{{ t('settings.behavior.allAtOnce') }}</option></SettingsSelect>
      </SettingsOption>
    </SettingsGroup>

    <SettingsGroup :title="t('settings.behavior.transport')" class="behavior-settings__section">
      <SettingsOption inline :title="t('settings.behavior.providerTransport')" :description="t('settings.behavior.providerTransportDesc')">
        <SettingsSelect :value="behavior.transport" :disabled="saving" @change="save({ transport: ($event.target as HTMLSelectElement).value as PiBehaviorSettings['transport'] })"><option value="auto">Automatic</option><option value="sse">Server-sent events</option><option value="websocket">WebSocket</option><option value="websocket-cached">Cached WebSocket</option></SettingsSelect>
      </SettingsOption>
      <SettingsOption inline :title="t('settings.behavior.httpIdleTimeout')" :description="t('settings.behavior.httpIdleTimeoutDesc')">
        <input :value="behavior.httpIdleTimeoutMs" type="number" min="0" step="1000" :disabled="saving" @change="saveIdleTimeout" />
      </SettingsOption>
    </SettingsGroup>
  </template>
</template>

<style scoped>
.behavior-settings__state { margin: 20px 0; color: var(--ui-text-muted); font-size: 13px; }
.behavior-settings__section { margin-top: 28px; }
</style>
