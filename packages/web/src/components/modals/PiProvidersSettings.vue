<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PiProviderSettings } from "@pichamber/shared";
import { fetchPiProviders, removePiProviderCredential, setPiProviderApiKey, toMessage } from "@/api/client";
import { workspace } from "@/stores/workspace";
import ProviderLogo from "@/components/workspace/ProviderLogo";
import SettingsPageHeader from "./SettingsPageHeader.vue";

const providers = ref<PiProviderSettings[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const editingProviderId = ref<string | null>(null);
const apiKey = ref("");
const saving = ref(false);

const orderedProviders = computed(() =>
  [...providers.value].sort((a, b) => Number(b.auth.configured) - Number(a.auth.configured) || a.name.localeCompare(b.name)),
);

const load = async () => {
  const sessionId = workspace.sessionId;
  providers.value = [];
  editingProviderId.value = null;
  error.value = null;
  if (!sessionId) return;
  loading.value = true;
  try {
    providers.value = (await fetchPiProviders(sessionId)).providers;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const startEditing = (providerId: string) => {
  editingProviderId.value = providerId;
  apiKey.value = "";
  error.value = null;
};

const saveApiKey = async (providerId: string) => {
  const sessionId = workspace.sessionId;
  if (!sessionId || !apiKey.value.trim()) return;
  saving.value = true;
  error.value = null;
  try {
    providers.value = (await setPiProviderApiKey(sessionId, providerId, apiKey.value.trim())).providers;
    editingProviderId.value = null;
    apiKey.value = "";
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const removeCredential = async (provider: PiProviderSettings) => {
  const sessionId = workspace.sessionId;
  if (!sessionId || !confirm(`Remove the stored credential for ${provider.name}?`)) return;
  saving.value = true;
  error.value = null;
  try {
    providers.value = (await removePiProviderCredential(sessionId, provider.id)).providers;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

watch(() => workspace.sessionId, load, { immediate: true });
</script>

<template>
  <SettingsPageHeader title="Providers" description="Manage API-key credentials for providers available to this session." />

  <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
  <p v-else-if="loading" class="provider-settings__state">Loading providers…</p>
  <p v-else-if="orderedProviders.length === 0" class="provider-settings__state">No providers available.</p>

  <div v-else class="provider-settings__list">
    <article v-for="provider in orderedProviders" :key="provider.id" class="provider-settings__row">
      <div class="provider-settings__identity">
        <ProviderLogo :provider-id="provider.id" :size="18" />
        <div>
          <strong>{{ provider.name }}</strong>
          <small>{{ provider.id }}<template v-if="provider.api"> · {{ provider.api }}</template></small>
        </div>
      </div>
      <div class="provider-settings__meta">
        <span :class="{ 'is-ready': provider.auth.configured }">
          {{ provider.auth.configured ? (provider.auth.label ?? "Configured") : "Not configured" }}
        </span>
        <small>{{ provider.modelCount }} models</small>
      </div>
      <div v-if="provider.auth.supportsApiKey" class="provider-settings__actions">
        <template v-if="editingProviderId === provider.id">
          <input
            v-model="apiKey"
            type="password"
            :disabled="saving"
            :placeholder="`${provider.name} API key`"
            @keydown.enter="saveApiKey(provider.id)"
            @keydown.esc="editingProviderId = null"
          />
          <button type="button" :disabled="saving || !apiKey.trim()" @click="saveApiKey(provider.id)">Save</button>
          <button type="button" :disabled="saving" @click="editingProviderId = null">Cancel</button>
        </template>
        <template v-else>
          <button type="button" :disabled="saving" @click="startEditing(provider.id)">
            {{ provider.auth.configured ? "Update key" : "Set key" }}
          </button>
          <button
            v-if="provider.auth.canRemove"
            type="button"
            class="is-danger"
            :disabled="saving"
            @click="removeCredential(provider)"
          >Remove</button>
        </template>
      </div>
    </article>
  </div>
</template>

<style scoped>
.provider-settings__state { margin: 20px 0; color: var(--ui-text-muted); font-size: 13px; }
.provider-settings__list { max-width: 760px; border-top: 1px solid var(--ui-border-subtle); }
.provider-settings__row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 18px; min-height: 64px; border-bottom: 1px solid var(--ui-border-subtle); }
.provider-settings__identity { display: flex; min-width: 0; align-items: center; gap: 10px; }
.provider-settings__identity :deep(.provider-logo) { flex: 0 0 18px; }
.provider-settings__identity div { display: grid; min-width: 0; gap: 2px; }
.provider-settings__identity strong { overflow: hidden; color: var(--ui-text-strong); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.provider-settings__identity small, .provider-settings__meta small { color: var(--ui-text-muted); font-size: 11px; }
.provider-settings__meta { display: grid; justify-items: end; gap: 2px; text-align: right; }
.provider-settings__meta > span { color: var(--ui-text-muted); font-size: 12px; }
.provider-settings__meta > span.is-ready { color: var(--ui-extension-fg); }
.provider-settings__actions { display: flex; align-items: center; justify-content: flex-end; gap: 5px; min-width: 190px; }
.provider-settings__actions input { width: 170px; height: 28px; min-width: 0; padding: 0 8px; border: 1px solid var(--ui-border); border-radius: 5px; outline: 0; background: var(--ui-surface); color: var(--ui-text); font: inherit; font-size: 12px; }
.provider-settings__actions input:focus { border-color: var(--ui-border-focus); }
.provider-settings__actions button { min-height: 27px; padding: 3px 7px; border-radius: 5px; color: var(--ui-text-muted); font: inherit; font-size: 11px; }
.provider-settings__actions button:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.provider-settings__actions button.is-danger:hover:not(:disabled) { background: var(--ui-error-hover); color: var(--ui-error-strong); }
.provider-settings__actions button:disabled { cursor: default; opacity: 0.5; }
@media (max-width: 640px) { .provider-settings__row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 10px 0; } .provider-settings__meta { display: none; } .provider-settings__actions { grid-column: 1 / -1; justify-content: flex-start; min-width: 0; } }
</style>
