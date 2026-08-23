<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchRuntimeMode, toMessage, updateRuntimeMode } from "@/api/client";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";
import SettingsPageHeader from "./SettingsPageHeader.vue";

const runtimeMode = ref<"sdk" | "rpc">("sdk");
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);

const load = async () => {
  loading.value = true;
  try {
    runtimeMode.value = (await fetchRuntimeMode()).runtimeMode;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const save = async (mode: "sdk" | "rpc") => {
  saving.value = true;
  error.value = null;
  try {
    if ((await updateRuntimeMode(mode)).reload) window.location.reload();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

onMounted(load);
</script>

<template>
  <SettingsPageHeader title="Runtime" description="Choose the Pi process mode used by this Pichamber server." />
  <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="runtime-settings__state">Loading runtime settings...</p>
  <SettingsGroup v-else title="Pi runtime">
    <SettingsOption inline title="Execution mode" description="Changing this stops active agent runs and reloads the application.">
      <select :value="runtimeMode" :disabled="saving" @change="save(($event.target as HTMLSelectElement).value as 'sdk' | 'rpc')">
        <option value="sdk">SDK runtime</option>
        <option value="rpc">Local Pi RPC</option>
      </select>
    </SettingsOption>
  </SettingsGroup>
</template>

<style scoped>
.runtime-settings__state { margin: 20px 0; color: var(--ui-text-muted); font-size: 13px; }
</style>
