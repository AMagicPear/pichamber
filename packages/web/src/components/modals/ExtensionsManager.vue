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

/** True if this built-in is currently loaded in the active session. */
const isBuiltinLoaded = (ext: PiBuiltinExtension): boolean => {
  const o = overview.value;
  if (!o) return false;
  return o.loaded.some((l) => l.builtinId === ext.id);
};

/** True if a configured source is currently loaded. Matches by source string or by installed path. */
const isSourceLoaded = (entry: PiExtensionSource): boolean => {
  const o = overview.value;
  if (!o) return false;
  return o.loaded.some(
    (l) =>
      l.source === entry.source ||
      (entry.installedPath !== undefined && (l.path === entry.installedPath || l.path.startsWith(`${entry.installedPath}/`))),
  );
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

    <SettingsGroup title="Loaded extensions" class="extension-manager__loaded">
      <p v-if="diagnostics.length" class="extension-manager__diagnostics">
        <strong>Load errors:</strong>
        <span v-for="diagnostic in diagnostics" :key="`${diagnostic.path}:${diagnostic.error}`">
          <code>{{ diagnostic.path }}</code> — {{ diagnostic.error }}
        </span>
      </p>
      <p v-else-if="loading" class="extension-manager__state">Loading…</p>
      <p v-else-if="!inventoryAvailable" class="extension-manager__state">
        The active runtime does not expose its extension inventory.
      </p>
      <p v-else-if="loaded.length === 0" class="extension-manager__state">
        No extensions are loaded for this session.
      </p>
      <ul v-else class="extension-manager__list">
        <li v-for="ext in loaded" :key="ext.path" class="extension-manager__row">
          <div class="extension-manager__row-main">
            <strong>{{ ext.source }}</strong>
            <small :title="ext.path">{{ ext.path }}</small>
          </div>
          <div class="extension-manager__row-meta">
            <span class="extension-manager__scope">{{ ext.scope }}</span>
            <span v-if="ext.commands.length || ext.tools.length" class="extension-manager__resources">
              <code v-for="command in ext.commands" :key="`command:${command}`">/{{ command }}</code>
              <code v-for="tool in ext.tools" :key="`tool:${tool}`">{{ tool }}</code>
            </span>
            <span v-else class="extension-manager__state">No commands or tools.</span>
          </div>
        </li>
      </ul>
    </SettingsGroup>

    <SettingsGroup title="Built-in extensions" class="extension-manager__builtins">
      <p class="extension-manager__hint">
        Extensions pichamber ships with. <strong>Configure</strong> installs one into your Pi's
        <code>extensions/</code> folder; it then loads when you run <code>pi</code> directly too.
      </p>
      <p v-if="!loading && builtins.length === 0" class="extension-manager__state">
        No built-in extensions available.
      </p>
      <ul v-else class="extension-manager__list">
        <li v-for="ext in builtins" :key="ext.id" class="extension-manager__row">
          <div class="extension-manager__row-main">
            <strong>{{ ext.name }} <span class="extension-manager__version">{{ ext.version }}</span></strong>
            <small>{{ ext.description }}</small>
          </div>
          <div class="extension-manager__row-meta">
            <span v-if="isBuiltinLoaded(ext)" class="extension-manager__badge">Loaded</span>
            <span v-else-if="ext.installed" class="extension-manager__badge is-muted">Installed</span>
            <span v-else class="extension-manager__badge is-dim">Not installed</span>
            <button
              v-if="ext.installed"
              type="button"
              class="is-danger"
              :disabled="saving"
              @click="remove(ext)"
            >Remove</button>
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
        <li v-for="entry in sources" :key="`${entry.scope}:${entry.source}`" class="extension-manager__row">
          <div class="extension-manager__row-main">
            <strong>{{ entry.source }}</strong>
            <small>
              {{ entry.scope === "project" ? "Project" : "Global" }}
              <template v-if="entry.filtered"> · filtered</template>
              <template v-if="entry.installedPath"> · {{ entry.installedPath }}</template>
            </small>
          </div>
          <div class="extension-manager__row-meta">
            <span v-if="isSourceLoaded(entry)" class="extension-manager__badge">Loaded</span>
            <span v-else class="extension-manager__badge is-dim">Not loaded</span>
            <button type="button" class="is-danger" :disabled="saving" @click="removeSource(entry)">Remove</button>
          </div>
        </li>
      </ul>
    </SettingsGroup>
  </div>
</template>

<style scoped>
.extension-manager { display: grid; gap: 28px; }
.extension-manager__hint { margin: 0 0 10px; color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
.extension-manager__hint strong { color: var(--ui-text-strong); font-weight: 600; }
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
.extension-manager__row {
  display: flex;
  flex-wrap: wrap;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  border-bottom: 1px solid var(--ui-border-subtle);
  padding: 8px 0;
}
.extension-manager__row-main { display: grid; min-width: 0; flex: 1 1 200px; gap: 2px; }
.extension-manager__row-main strong { color: var(--ui-text-strong); font-family: var(--ui-font-mono); font-size: 12px; font-weight: 500; }
.extension-manager__row-main small { color: var(--ui-text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.extension-manager__row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; flex: 2 1 280px; min-width: 0; justify-content: flex-end; }
.extension-manager__version { color: var(--ui-text-muted); font-weight: 400; font-size: 11px; }
.extension-manager__scope { padding: 2px 5px; border-radius: 4px; background: var(--ui-surface-selected); color: var(--ui-text-muted); font-size: 10px; }
.extension-manager__resources { display: flex; flex-wrap: wrap; gap: 4px; max-width: 100%; }
.extension-manager__resources code { padding: 2px 5px; border-radius: 4px; background: var(--ui-extension-bg, var(--ui-surface-selected)); color: var(--ui-extension-fg, var(--ui-text-muted)); font-size: 10px; overflow-wrap: anywhere; }
.extension-manager__badge { padding: 2px 6px; border-radius: 4px; background: var(--ui-success-bg, rgba(76, 175, 80, 0.15)); color: var(--ui-success, #4caf50); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.extension-manager__badge.is-muted { background: var(--ui-surface-selected); color: var(--ui-text-muted); }
.extension-manager__badge.is-dim { background: transparent; color: var(--ui-text-muted); border: 1px solid var(--ui-border-subtle); }
.extension-manager__add { display: flex; align-items: center; gap: 5px; }
.extension-manager__add input { width: 220px; min-width: 0; }
.extension-manager__add select { min-width: 82px !important; }
.extension-manager__add button, .extension-manager__row button { min-height: 27px; padding: 3px 10px; border-radius: 5px; color: var(--ui-text-muted); font: inherit; font-size: 11px; }
.extension-manager__add button:hover:not(:disabled), .extension-manager__row button:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.extension-manager__row button.is-danger:hover:not(:disabled) { background: var(--ui-error-hover); color: var(--ui-error-strong); }
.extension-manager__add button:disabled, .extension-manager__row button:disabled { cursor: default; opacity: 0.5; }
@media (max-width: 640px) {
  .extension-manager__row-meta { width: 100%; justify-content: flex-start; }
  .extension-manager__add { width: 100%; flex-wrap: wrap; }
  .extension-manager__add input { flex: 1 1 100%; width: 100%; }
}
</style>