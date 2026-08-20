<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { ExtensionsOverview, PiBuiltinExtension, PiExtensionSource } from "@pichamber/shared";
import {
  fetchPiExtensionsOverview,
  installPiExtensionSource,
  removePiExtensionSource,
  setPiBuiltinExtension,
  toMessage,
} from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";

const overview = ref<ExtensionsOverview | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const saving = ref(false);

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

const scopeLabel = (scope: "user" | "project" | "temporary") =>
  scope === "user" ? "Global" : scope === "project" ? "Project" : "Session";

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
  if (!confirm(`Remove built-in extension "${ext.name}" from your Pi extensions folder?`)) return;
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
  if (!confirm(`Remove source "${entry.source}"?`)) return;
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

watch(() => workspace.sessionId, load);
onMounted(load);
</script>

<template>
  <div class="extension-manager">
    <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>

    <SettingsGroup title="Built-in extensions" class="extension-manager__builtins">
      <p class="extension-manager__hint">
        Installed into your Pi agent directory and available to pichamber and <code>pi</code>. Updates are explicit.
      </p>
      <p v-if="!loading && builtins.length === 0" class="extension-manager__state">
        No built-in extensions available.
      </p>
      <ul v-else class="extension-manager__list">
        <li v-for="ext in builtins" :key="ext.id" class="extension-manager__manage-row">
          <div class="extension-manager__item-copy">
            <strong>{{ ext.name }} <small>{{ ext.version }}</small></strong>
            <small>{{ ext.description }}</small>
          </div>
          <div class="extension-manager__actions">
            <template v-if="ext.installed">
              <button type="button" :disabled="saving" @click="install(ext)">Update</button>
              <button type="button" class="is-danger" :disabled="saving" @click="remove(ext)">Remove</button>
            </template>
            <button v-else type="button" :disabled="saving" @click="install(ext)">Configure</button>
          </div>
        </li>
      </ul>
    </SettingsGroup>

    <SettingsGroup title="Package sources" class="extension-manager__sources">
      <SettingsOption inline title="Add source" description="Use npm:, git:, a URL, or a local package path.">
        <span class="extension-manager__add">
          <input
            v-model="newSource"
            type="text"
            :disabled="saving"
            placeholder="npm:package or ./extension"
            @keydown.enter="addSource"
          />
          <select v-model="newScope" :disabled="saving">
            <option value="user">Global</option>
            <option value="project">Project</option>
          </select>
          <button type="button" :disabled="saving || !newSource.trim()" @click="addSource">Add</button>
        </span>
      </SettingsOption>
      <p class="extension-manager__hint">New sources load when the next session starts.</p>
      <p v-if="!loading && sources.length === 0" class="extension-manager__state">No package sources configured.</p>
      <ul v-else class="extension-manager__list">
        <li v-for="entry in sources" :key="`${entry.scope}:${entry.source}`" class="extension-manager__manage-row">
          <div class="extension-manager__item-copy">
            <strong>{{ entry.source }}</strong>
            <small>
              {{ scopeLabel(entry.scope) }}
              <template v-if="entry.filtered"> · filtered</template>
              <template v-if="entry.installedPath"> · {{ entry.installedPath }}</template>
            </small>
          </div>
          <div class="extension-manager__actions">
            <button type="button" class="is-danger" :disabled="saving" @click="removeSource(entry)">Remove</button>
          </div>
        </li>
      </ul>
    </SettingsGroup>

    <SettingsGroup title="Current session" class="extension-manager__session">
      <p v-if="diagnostics.length" class="extension-manager__diagnostics">
        <strong>Load errors</strong>
        <span v-for="diagnostic in diagnostics" :key="`${diagnostic.path}:${diagnostic.error}`">
          <code>{{ diagnostic.path }}</code> — {{ diagnostic.error }}
        </span>
      </p>
      <p v-else-if="loading" class="extension-manager__state">Loading extensions…</p>
      <p v-else-if="!inventoryAvailable" class="extension-manager__state">
        The active runtime does not expose its extension inventory.
      </p>
      <p v-else-if="loaded.length === 0" class="extension-manager__state">
        No extensions are active in this session.
      </p>
      <ul v-else class="extension-manager__list">
        <li v-for="ext in loaded" :key="ext.path" class="extension-manager__active-row">
          <header>
            <strong>{{ ext.label }}</strong>
            <small>{{ scopeLabel(ext.scope) }} · {{ ext.origin === "package" ? "package" : "extension" }}</small>
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
.extension-manager__add input { width: 220px; min-width: 0; }
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
  .extension-manager__add input { flex: 1 1 100%; width: 100%; }
}
</style>
