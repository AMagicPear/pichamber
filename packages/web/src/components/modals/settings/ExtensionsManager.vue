<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ExtensionsOverview, PiBuiltinExtension, PiExtensionSource, PiExtensionUpdate } from "@amagicpear/pichamber-shared";
import {
  checkPiExtensionUpdates,
  fetchPiExtensionsOverview,
  installPiExtensionSource,
  removePiExtensionSource,
  setPiBuiltinExtension,
  toMessage,
  updatePiExtensions,
} from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";
import SearchBox from "@/components/ui/SearchBox.vue";

const { t } = useI18n();

const overview = ref<ExtensionsOverview | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const saving = ref(false);
const checkingUpdates = ref(false);
const updates = ref<PiExtensionUpdate[]>([]);
const updatesChecked = ref(false);

const newSource = ref("");
const newScope = ref<"user" | "project">("user");

const load = async () => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  loading.value = true;
  error.value = null;
  try {
    overview.value = await fetchPiExtensionsOverview(sessionId);
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const checkUpdates = async () => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  checkingUpdates.value = true;
  error.value = null;
  try {
    updates.value = (await checkPiExtensionUpdates(sessionId)).updates;
    updatesChecked.value = true;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    checkingUpdates.value = false;
  }
};

const updatePackages = async (source?: string) => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  saving.value = true;
  error.value = null;
  try {
    updates.value = (await updatePiExtensions(sessionId, source)).updates;
    updatesChecked.value = true;
    await load();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const install = async (ext: PiBuiltinExtension) => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  saving.value = true;
  error.value = null;
  try {
    await setPiBuiltinExtension(sessionId, ext.id, true);
    await load();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const remove = async (ext: PiBuiltinExtension) => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  if (!confirm(t('settings.extensions.removeBuiltinConfirm', { name: ext.name }))) return;
  saving.value = true;
  error.value = null;
  try {
    await setPiBuiltinExtension(sessionId, ext.id, false);
    await load();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const addSource = async () => {
  const sessionId = workspace.sessionId;
  const value = newSource.value.trim();
  if (!sessionId || !value) return;
  saving.value = true;
  error.value = null;
  try {
    await installPiExtensionSource(sessionId, value, newScope.value);
    newSource.value = "";
    await load();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const removeSource = async (entry: PiExtensionSource) => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  if (!confirm(t('settings.extensions.removeSourceConfirm', { source: entry.source }))) return;
  saving.value = true;
  error.value = null;
  try {
    await removePiExtensionSource(sessionId, entry.source, entry.scope);
    await load();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const diagnostics = computed(() => overview.value?.diagnostics ?? []);
const loaded = computed(() => overview.value?.loaded ?? []);
const builtins = computed(() => overview.value?.builtins ?? []);
const sources = computed(() => overview.value?.sources ?? []);
const inventoryAvailable = computed(() => overview.value?.inventoryAvailable ?? false);

watch(() => workspace.sessionId, async () => {
  updates.value = [];
  updatesChecked.value = false;
  await load();
  await checkUpdates();
});
onMounted(async () => {
  await load();
  await checkUpdates();
});
</script>

<template>
  <div class="extension-manager">
    <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>

    <SettingsGroup :title="t('settings.extensions.builtinExtensions')" class="extension-manager__builtins">
      <p class="extension-manager__hint">
        <i18n-t keypath="settings.extensions.builtinHint" tag="span">
          <template #code><code>pi</code></template>
        </i18n-t>
      </p>
      <p v-if="!loading && builtins.length === 0" class="extension-manager__state">
        {{ t('settings.extensions.noBuiltins') }}
      </p>
      <ul v-else class="extension-manager__list">
        <li v-for="ext in builtins" :key="ext.id" class="extension-manager__manage-row">
          <div class="extension-manager__item-copy">
            <strong>{{ ext.name }} <small>{{ ext.version }}</small></strong>
            <small>{{ ext.description }}</small>
          </div>
          <div class="extension-manager__actions">
            <template v-if="ext.installed">
              <button type="button" :disabled="saving" @click="install(ext)">{{ t('common.update') }}</button>
              <button type="button" class="is-danger" :disabled="saving" @click="remove(ext)">{{ t('common.remove') }}</button>
            </template>
            <button v-else type="button" :disabled="saving" @click="install(ext)">{{ t('settings.extensions.configure') }}</button>
          </div>
        </li>
      </ul>
    </SettingsGroup>

    <SettingsGroup :title="t('settings.extensions.packageSources')" class="extension-manager__sources">
      <div class="extension-manager__update-bar">
        <span>
          <strong v-if="updates.length">{{ t('settings.extensions.updatesAvailable', { count: updates.length }) }}</strong>
          <span v-else-if="checkingUpdates">{{ t('settings.extensions.checkingUpdates') }}</span>
          <span v-else-if="updatesChecked">{{ t('settings.extensions.noUpdatesAvailable') }}</span>
          <span v-else>{{ t('settings.extensions.updatesNotChecked') }}</span>
        </span>
        <div class="extension-manager__actions">
          <button type="button" :disabled="saving || checkingUpdates" @click="checkUpdates">{{ t('settings.extensions.checkAgain') }}</button>
          <button v-if="updates.length" type="button" :disabled="saving || checkingUpdates" @click="updatePackages()">
            {{ t('settings.extensions.updateAll') }}
          </button>
        </div>
      </div>
      <SettingsOption inline :title="t('settings.extensions.addSource')" :description="t('settings.extensions.addSourceDesc')">
        <span class="extension-manager__add">
          <SearchBox
            v-model="newSource"
            type="text"
            size="compact"
            :disabled="saving"
            :placeholder="t('settings.extensions.sourcePlaceholder')"
            :label="t('settings.extensions.sourceLabel')"
            @enter="addSource"
          />
          <select v-model="newScope" :disabled="saving">
            <option value="user">Global</option>
            <option value="project">Project</option>
          </select>
          <button type="button" :disabled="saving || !newSource.trim()" @click="addSource">{{ t('common.add') }}</button>
        </span>
      </SettingsOption>
      <p class="extension-manager__hint">{{ t('settings.extensions.newSourcesHint') }}</p>
      <p v-if="!loading && sources.length === 0" class="extension-manager__state">{{ t('settings.extensions.noSources') }}</p>
      <ul v-else class="extension-manager__list">
        <li v-for="entry in sources" :key="`${entry.scope}:${entry.source}`" class="extension-manager__manage-row">
          <div class="extension-manager__item-copy">
            <strong>{{ entry.source }} <small v-if="entry.version">v{{ entry.version }}</small></strong>
            <small>
              {{ t(`settings.extensions.scope.${entry.scope}`) }}
              <template v-if="updates.some((update) => update.source === entry.source && update.scope === entry.scope)"> · {{ t('settings.extensions.updateAvailable') }}</template>
              <template v-if="entry.filtered"> · {{ t('settings.extensions.filtered') }}</template>
              <template v-if="entry.installedPath"> · {{ entry.installedPath }}</template>
            </small>
          </div>
          <div class="extension-manager__actions">
            <button
              v-if="updates.some((update) => update.source === entry.source && update.scope === entry.scope)"
              type="button"
              :disabled="saving || checkingUpdates"
              @click="updatePackages(entry.source)"
            >{{ t('common.update') }}</button>
            <button type="button" class="is-danger" :disabled="saving" @click="removeSource(entry)">{{ t('common.remove') }}</button>
          </div>
        </li>
      </ul>
    </SettingsGroup>

    <SettingsGroup :title="t('settings.extensions.currentSession')" class="extension-manager__session">
      <p v-if="diagnostics.length" class="extension-manager__diagnostics">
        <strong>{{ t('settings.extensions.loadErrors') }}</strong>
        <span v-for="diagnostic in diagnostics" :key="`${diagnostic.path}:${diagnostic.error}`">
          <code>{{ diagnostic.path }}</code> - {{ diagnostic.error }}
        </span>
      </p>
      <p v-else-if="loading" class="extension-manager__state">{{ t('settings.extensions.loadingExtensions') }}</p>
      <p v-else-if="!inventoryAvailable" class="extension-manager__state">
        {{ t('settings.extensions.noInventory') }}
      </p>
      <p v-else-if="loaded.length === 0" class="extension-manager__state">
        {{ t('settings.extensions.noActiveExtensions') }}
      </p>
      <ul v-else class="extension-manager__list">
        <li v-for="ext in loaded" :key="ext.path" class="extension-manager__active-row">
          <header>
            <strong>{{ ext.label }}</strong>
            <small>{{ t(`settings.extensions.scope.${ext.scope}`) }} · {{ t(`settings.extensions.origin.${ext.origin}`) }}</small>
          </header>
          <small class="extension-manager__path" :title="ext.path">{{ ext.path }}</small>
          <div v-if="ext.commands.length || ext.tools.length" class="extension-manager__resources">
            <code v-for="command in ext.commands" :key="`command:${command}`">/{{ command }}</code>
            <code v-for="tool in ext.tools" :key="`tool:${tool}`">{{ tool }}</code>
          </div>
        </li>
      </ul>
    </SettingsGroup>
  </div>
</template>

<style scoped>
.extension-manager { display: grid; gap: 30px; }
.extension-manager__hint { margin: 0 0 10px; color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
.extension-manager__hint code { color: var(--ui-text-strong); font-family: var(--ui-font-mono); }
.extension-manager__state { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
.extension-manager__diagnostics {
  display: grid;
  gap: 4px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-left: 3px solid var(--ui-error-strong);
  border-radius: 4px;
  background: var(--ui-error-bg);
  color: var(--ui-error-fg);
  font-size: 12px;
}
.extension-manager__diagnostics strong { font-weight: 600; }
.extension-manager__diagnostics code { font-family: var(--ui-font-mono); overflow-wrap: anywhere; }
.extension-manager__list { margin: 0; padding: 0; border-top: 1px solid var(--ui-border-subtle); list-style: none; }
.extension-manager__manage-row {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--ui-border-subtle);
  padding: 8px 0;
}
.extension-manager__item-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }
.extension-manager__item-copy strong { color: var(--ui-text-strong); font-family: var(--ui-font-mono); font-size: 12px; font-weight: 500; }
.extension-manager__item-copy strong small { color: var(--ui-text-muted); font-family: var(--ui-font-sans); font-size: 11px; font-weight: 400; }
.extension-manager__item-copy > small { overflow: hidden; color: var(--ui-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.extension-manager__builtins .extension-manager__item-copy > small { line-height: 1.45; overflow: visible; text-overflow: clip; white-space: normal; }
.extension-manager__actions { display: flex; flex-shrink: 0; gap: 4px; }
.extension-manager__active-row { display: grid; gap: 6px; border-bottom: 1px solid var(--ui-border-subtle); padding: 10px 0; }
.extension-manager__active-row header { display: flex; min-width: 0; align-items: baseline; justify-content: space-between; gap: 12px; }
.extension-manager__active-row strong { overflow: hidden; color: var(--ui-text-strong); font-family: var(--ui-font-mono); font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.extension-manager__active-row header small, .extension-manager__path { color: var(--ui-text-muted); font-size: 11px; }
.extension-manager__active-row header small { flex-shrink: 0; }
.extension-manager__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.extension-manager__resources { display: flex; flex-wrap: wrap; gap: 4px; }
.extension-manager__resources code { padding: 2px 5px; border-radius: 4px; background: var(--ui-accent-soft); color: var(--ui-accent-text); font-size: 10px; overflow-wrap: anywhere; }
.extension-manager__add { display: flex; align-items: center; gap: 5px; }
.extension-manager__add > .search-box { width: 220px; flex: 0 0 auto; }
.extension-manager__update-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; color: var(--ui-text-muted); font-size: 12px; }
.extension-manager__update-bar strong { color: var(--ui-status-text); font-weight: 600; }
.extension-manager__add select { min-width: 82px !important; }
.extension-manager__add button, .extension-manager__actions button { min-height: 27px; padding: 3px 10px; border-radius: 5px; color: var(--ui-text-muted); font: inherit; font-size: 11px; }
.extension-manager__add button:hover:not(:disabled), .extension-manager__actions button:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.extension-manager__actions button.is-danger:hover:not(:disabled) { background: var(--ui-error-hover); color: var(--ui-error-strong); }
.extension-manager__add button:disabled, .extension-manager__actions button:disabled { cursor: default; opacity: 0.5; }
@media (max-width: 640px) {
  .extension-manager__manage-row { flex-wrap: wrap; }
  .extension-manager__actions { width: 100%; }
  .extension-manager__active-row header { align-items: flex-start; flex-direction: column; gap: 2px; }
  .extension-manager__add { width: 100%; flex-wrap: wrap; }
  .extension-manager__add > .search-box { flex: 1 1 100%; width: 100%; }
}
</style>
