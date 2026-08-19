<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { PiBuiltinExtension } from "@pichamber/shared";
import { fetchPiBuiltinExtensions, setPiBuiltinExtension, toMessage } from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";

const builtins = ref<PiBuiltinExtension[]>([]);
const loading = ref(false);
const busyId = ref<string | null>(null);
const error = ref<string | null>(null);
const reloaded = ref(false);

const load = async () => {
  loading.value = true;
  error.value = null;
  try {
    builtins.value = (await fetchPiBuiltinExtensions()).builtins;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const configure = async (ext: PiBuiltinExtension, install: boolean) => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  busyId.value = ext.id;
  error.value = null;
  reloaded.value = false;
  try {
    builtins.value = (await setPiBuiltinExtension(sessionId, ext.id, install)).builtins;
    reloaded.value = true;
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    busyId.value = null;
  }
};

onMounted(load);
</script>

<template>
  <SettingsGroup title="Built-in extensions" class="builtin-extensions">
    <p class="builtin-extensions__hint">
      Extensions pichamber ships with. Click <strong>Configure</strong> to install one into your
      Pi's <code>extensions/</code> folder — it then also loads when you run <code>pi</code> directly.
    </p>

    <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
    <p v-else-if="reloaded" class="builtin-extensions__state is-ok">
      Installed and session extensions reloaded.
    </p>
    <p v-else-if="loading" class="builtin-extensions__state">Loading built-in extensions…</p>

    <div v-else-if="builtins.length" class="builtin-extensions__list">
      <article v-for="ext in builtins" :key="ext.id" class="builtin-extensions__row">
        <div class="builtin-extensions__body">
          <div class="builtin-extensions__title">
            <strong>{{ ext.name }}</strong>
            <span>{{ ext.version }}<template v-if="ext.installed"> · installed</template></span>
          </div>
          <p>{{ ext.description }}</p>
        </div>
        <button
          v-if="ext.installed"
          type="button"
          class="is-danger"
          :disabled="busyId !== null"
          @click="configure(ext, false)"
        >Remove</button>
        <button
          v-else
          type="button"
          :disabled="busyId !== null"
          @click="configure(ext, true)"
        >Configure</button>
      </article>
    </div>
    <p v-else class="builtin-extensions__state">No built-in extensions available.</p>
  </SettingsGroup>
</template>

<style scoped>
.builtin-extensions { margin-top: 28px; }
.builtin-extensions__hint { margin: 0 0 12px; color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
.builtin-extensions__hint strong { color: var(--ui-text-strong); font-weight: 600; }
.builtin-extensions__hint code { color: var(--ui-text-strong); font-family: var(--ui-font-mono); }
.builtin-extensions__state { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
.builtin-extensions__state.is-ok { color: var(--ui-success, #4caf50); }
.builtin-extensions__list { border-top: 1px solid var(--ui-border-subtle); }
.builtin-extensions__row { display: flex; min-height: 64px; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--ui-border-subtle); padding: 10px 0; }
.builtin-extensions__body { display: grid; min-width: 0; gap: 4px; }
.builtin-extensions__title { display: flex; align-items: baseline; gap: 8px; }
.builtin-extensions__title strong { color: var(--ui-text-strong); font-size: 13px; font-weight: 600; }
.builtin-extensions__title span { color: var(--ui-text-muted); font-size: 11px; }
.builtin-extensions__body p { margin: 0; color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
.builtin-extensions__row button { min-height: 27px; padding: 3px 10px; border-radius: 5px; color: var(--ui-text-muted); font: inherit; font-size: 11px; }
.builtin-extensions__row button:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.builtin-extensions__row button.is-danger:hover:not(:disabled) { background: var(--ui-error-hover); color: var(--ui-error-strong); }
.builtin-extensions__row button:disabled { cursor: default; opacity: 0.5; }
</style>
