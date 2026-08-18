<script setup lang="ts">
import { ref, watch } from "vue";
import type { PiExtensionSource } from "@pichamber/shared";
import {
  fetchPiExtensionSources,
  installPiExtensionSource,
  removePiExtensionSource,
  toMessage,
} from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";

const sources = ref<PiExtensionSource[]>([]);
const source = ref("");
const scope = ref<"user" | "project">("user");
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const load = async () => {
  const sessionId = workspace.sessionId;
  sources.value = [];
  error.value = null;
  if (!sessionId) return;
  loading.value = true;
  try {
    sources.value = (await fetchPiExtensionSources(sessionId)).sources;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const addSource = async () => {
  const sessionId = workspace.sessionId;
  if (!sessionId || !source.value.trim()) return;
  saving.value = true;
  error.value = null;
  try {
    sources.value = (await installPiExtensionSource(sessionId, source.value.trim(), scope.value)).sources;
    source.value = "";
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const removeSource = async (entry: PiExtensionSource) => {
  const sessionId = workspace.sessionId;
  if (!sessionId || !confirm(`Remove ${entry.source}?`)) return;
  saving.value = true;
  error.value = null;
  try {
    sources.value = (await removePiExtensionSource(sessionId, entry.source, entry.scope)).sources;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

watch(() => workspace.sessionId, load, { immediate: true });
</script>

<template>
  <SettingsGroup title="Configured sources" class="extension-sources">
    <SettingsOption inline title="Add source" description="Use npm:, git:, a URL, or a local package path.">
      <span class="extension-sources__add">
        <input v-model="source" type="text" :disabled="saving" placeholder="npm:package or ./extension" @keydown.enter="addSource" />
        <select v-model="scope" :disabled="saving"><option value="user">Global</option><option value="project">Project</option></select>
        <button type="button" :disabled="saving || !source.trim()" @click="addSource">Add</button>
      </span>
    </SettingsOption>
    <p class="extension-sources__state">New sources load when the next session starts.</p>

    <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="extension-sources__state">Loading configured sources…</p>
    <p v-else-if="sources.length === 0" class="extension-sources__state">No package sources configured.</p>

    <div v-else class="extension-sources__list">
      <article v-for="entry in sources" :key="`${entry.scope}:${entry.source}`" class="extension-sources__row">
        <div>
          <strong>{{ entry.source }}</strong>
          <small>{{ entry.scope === "project" ? "Project" : "Global" }}<template v-if="entry.installedPath"> · {{ entry.installedPath }}</template></small>
        </div>
        <button type="button" class="is-danger" :disabled="saving" @click="removeSource(entry)">Remove</button>
      </article>
    </div>
  </SettingsGroup>
</template>

<style scoped>
.extension-sources { margin-top: 28px; }
.extension-sources__add { display: flex; align-items: center; gap: 5px; }
.extension-sources__add input { width: 220px; min-width: 0; }
.extension-sources__add select { min-width: 82px !important; }
.extension-sources__add button, .extension-sources__row button { min-height: 27px; padding: 3px 7px; border-radius: 5px; color: var(--ui-text-muted); font: inherit; font-size: 11px; }
.extension-sources__add button:hover:not(:disabled), .extension-sources__row button:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.extension-sources__row button.is-danger:hover:not(:disabled) { background: var(--ui-error-hover); color: var(--ui-error-strong); }
.extension-sources__add button:disabled, .extension-sources__row button:disabled { cursor: default; opacity: 0.5; }
.extension-sources__state { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
.extension-sources__list { border-top: 1px solid var(--ui-border-subtle); }
.extension-sources__row { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--ui-border-subtle); }
.extension-sources__row div { display: grid; min-width: 0; gap: 2px; }
.extension-sources__row strong { overflow: hidden; color: var(--ui-text-strong); font-family: var(--ui-font-mono); font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.extension-sources__row small { overflow: hidden; color: var(--ui-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 640px) { .extension-sources__add { width: 100%; flex-wrap: wrap; } .extension-sources__add input { flex: 1 1 100%; width: 100%; } }
</style>
