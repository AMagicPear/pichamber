<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fetchExecutionBackend, toMessage, updateExecutionBackend } from "@/api/client";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";
import SettingsSelect from "./SettingsSelect.vue";
import SettingsPageHeader from "./SettingsPageHeader.vue";

const { t } = useI18n();

const executionBackend = ref<"sdk" | "rpc">("sdk");
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);

const load = async () => {
  loading.value = true;
  try {
    executionBackend.value = (await fetchExecutionBackend()).executionBackend;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const save = async (backend: "sdk" | "rpc") => {
  saving.value = true;
  error.value = null;
  try {
    if ((await updateExecutionBackend(backend)).reload) window.location.reload();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

onMounted(load);
</script>

<template>
  <SettingsPageHeader :title="t('settings.runtime.title')" :description="t('settings.runtime.description')" />
  <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="runtime-settings__state">{{ t('settings.runtime.loadingRuntime') }}</p>
  <SettingsGroup v-else :title="t('settings.runtime.piExecution')">
    <SettingsOption inline :title="t('settings.runtime.executionBackend')" :description="t('settings.runtime.executionBackendDesc')">
      <SettingsSelect :value="executionBackend" :disabled="saving" @change="save(($event.target as HTMLSelectElement).value as 'sdk' | 'rpc')">
        <option value="sdk">{{ t('settings.runtime.embeddedSdk') }}</option>
        <option value="rpc">{{ t('settings.runtime.cliRpc') }}</option>
      </SettingsSelect>
    </SettingsOption>
  </SettingsGroup>
</template>

<style scoped>
.runtime-settings__state { margin: 20px 0; color: var(--ui-text-muted); font-size: 13px; }
</style>
