/**
 * Server settings store.
 *
 * Mirrors the persisted runtime settings the server keeps at
 * `$PICHAMBER_SETTINGS_DIR/server.json` (see `server-settings.ts` on the
 * backend). The store owns the latest snapshot and exposes a typed
 * `update()` that PUTs the partial change to the server.
 *
 * Settings are loaded once on mount via `loadServerSettings()` — the
 * SettingsView modal calls this from its setup block so the form is
 * always populated before the user interacts with it.
 */
import { ref } from "vue";
import type { ServerSettings } from "@amagicpear/pichamber-shared";
import { fetchServerSettings, toMessage, updateServerSettings } from "@/api/client";

const defaults: ServerSettings = {
  useExternalPi: false,
  externalPiPath: "",
  externalPi: { configured: false, rawPath: "", resolved: null },
};

const serverSettings = ref<ServerSettings>({ ...defaults });
const serverSettingsLoaded = ref(false);
const serverSettingsError = ref<string | null>(null);
const serverSettingsSaving = ref(false);
let saveVersion = 0;
let saveQueue = Promise.resolve();

type WritableServerSettings = Pick<ServerSettings, "useExternalPi" | "externalPiPath">;

const writableSettings = (
  current: ServerSettings,
  next: Partial<ServerSettings>,
): WritableServerSettings => ({
  useExternalPi:
    typeof next.useExternalPi === "boolean" ? next.useExternalPi : current.useExternalPi,
  externalPiPath:
    typeof next.externalPiPath === "string" ? next.externalPiPath : current.externalPiPath,
});

const applyOptimisticSettings = (next: WritableServerSettings) => {
  const current = serverSettings.value;
  serverSettings.value = {
    ...current,
    ...next,
    externalPi: {
      configured: next.useExternalPi,
      rawPath: next.externalPiPath,
      // The server owns executable resolution. Keep a previous resolution
      // only while its inputs still match; otherwise wait for its response.
      resolved:
        current.externalPi.configured === next.useExternalPi &&
        current.externalPi.rawPath === next.externalPiPath
          ? current.externalPi.resolved
          : null,
    },
  };
};

const persistSnapshot = async (snapshot: WritableServerSettings, version: number) => {
  try {
    const saved = await updateServerSettings(snapshot);
    // A later user action may already be reflected optimistically. Do
    // not let this older response roll that change back in the UI.
    if (version === saveVersion) {
      serverSettings.value = saved;
      serverSettingsError.value = null;
    }
  } catch (error) {
    if (version === saveVersion) serverSettingsError.value = toMessage(error);
    throw error;
  } finally {
    if (version === saveVersion) serverSettingsSaving.value = false;
  }
};

const loadServerSettings = async () => {
  const version = saveVersion;
  try {
    const loaded = await fetchServerSettings();
    if (version === saveVersion) {
      serverSettings.value = loaded;
      serverSettingsError.value = null;
    }
  } catch (error) {
    serverSettingsError.value = toMessage(error);
  } finally {
    serverSettingsLoaded.value = true;
  }
};

const saveServerSettings = async (next: Partial<ServerSettings>) => {
  const snapshot = writableSettings(serverSettings.value, next);
  applyOptimisticSettings(snapshot);
  const version = ++saveVersion;
  serverSettingsSaving.value = true;
  const operation = saveQueue.then(() => persistSnapshot(snapshot, version));
  // Keep the queue live after a failed save so a later correction can persist.
  saveQueue = operation.catch(() => undefined);
  return operation;
};

export const useServerSettings = () => ({
  settings: serverSettings,
  loaded: serverSettingsLoaded,
  error: serverSettingsError,
  saving: serverSettingsSaving,
  load: loadServerSettings,
  save: saveServerSettings,
});
