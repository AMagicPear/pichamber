import { ref, watch } from "vue";
import { fetchQuotaProviders } from "@/api/client";
import { workspace } from "@/stores/workspace";
import type { ProviderDescriptor } from "@pichamber/shared";

/** Providers the server can quote, with their Pi SDK display names —
 *  populated from `/api/quota/providers` (the server's registry + Pi's
 *  provider registry are the source of truth), not hard-coded.
 *  Module-level so the panel and the header share one fetch. */
const supportedProviders = ref<ProviderDescriptor[]>([]);
let loadPromise: Promise<void> | null = null;

/** Fetch the supported provider list. The endpoint needs a session to
 *  resolve provider auth/names from Pi's registry, so it re-runs whenever
 *  the active session changes. Concurrent calls share one request. */
export const loadQuotaProviders = (): Promise<void> => {
  const sessionId = workspace.sessionId;
  if (!sessionId) {
    supportedProviders.value = [];
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;
  loadPromise = fetchQuotaProviders(sessionId)
    .then(({ providers }) => {
      supportedProviders.value = providers;
    })
    .catch(() => {
      supportedProviders.value = [];
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
};

/** Reactive list of supported providers (id + display name). */
export const getQuotaProviders = () => supportedProviders;

// Re-fetch when the active session changes — provider names/auth come from
// that session's Pi registry.
watch(
  () => workspace.sessionId,
  () => {
    void loadQuotaProviders();
  },
);
