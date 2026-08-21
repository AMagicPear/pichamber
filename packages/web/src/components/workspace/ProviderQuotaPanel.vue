<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { fetchProviderQuota } from "@/api/client";
import { getQuotaProviders, loadQuotaProviders } from "@/stores/quota";
import { availableModels, workspace } from "@/stores/workspace";
import type { ModelDescriptor, ProviderDescriptor, ProviderQuota, QuotaWindow } from "@amagicpear/pichamber-shared";
import ProviderLogo from "./ProviderLogo";

const props = defineProps<{ open: boolean }>();

/** Providers we can actually quote: the intersection of what the Pi SDK
 *  reports as configured (`availableModels`) and what the server registry
 *  supports (`getQuotaProviders()`). Display name comes from Pi. */
const providers = computed(() => {
  const supported = new Map(getQuotaProviders().value.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: Array<ProviderDescriptor & { model: ModelDescriptor }> = [];
  for (const candidate of availableModels.value) {
    if (seen.has(candidate.provider)) continue;
    const info = supported.get(candidate.provider);
    if (!info) continue;
    seen.add(candidate.provider);
    // ModelDescriptor.providerName is the same registry value used by the
    // model selector. Keep the REST label only as a defensive fallback for
    // a provider that has no model descriptor in the current session.
    out.push({ id: candidate.provider, name: candidate.providerName || info.name, model: candidate });
  }
  return out;
});

onMounted(() => {
  void loadQuotaProviders();
});

const quotaByProvider = ref<Record<string, ProviderQuota | undefined>>({});
const loading = ref(true);

const refresh = async () => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  loading.value = true;
  try {
    const results = await Promise.all(
      providers.value.map(async (provider) => {
        try {
          const quota = await fetchProviderQuota(sessionId, provider.id);
          return [provider.id, quota] as const;
        } catch (error) {
          return [
            provider.id,
            {
              provider: provider.id,
              error: error instanceof Error ? error.message : String(error),
              fetchedAt: Date.now(),
            } satisfies ProviderQuota,
          ] as const;
        }
      }),
    );
    quotaByProvider.value = Object.fromEntries(results);
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.open,
  (open) => {
    if (open) void refresh();
  },
  { immediate: true },
);

const quotaFor = (provider: string) => quotaByProvider.value[provider];

const formatReset = (ms: number) => {
  if (!ms) return "—";
  const diff = ms - Date.now();
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) {
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  }
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return `${days}d ${remainder}h`;
};

const tone = (utilization: number) =>
  utilization > 0.85 ? "danger" : utilization > 0.6 ? "warn" : "ok";

const hasBar = (window: QuotaWindow) =>
  !window.display && window.utilization > 0 && window.resetsAt > 0;

const formatNumber = (n: number) =>
  Number.isInteger(n) ? n.toString() : n.toFixed(2);
</script>

<template>
  <div class="quota-panel">
    <header class="quota-panel__head">
      <div class="quota-panel__title">
        <span>Usage & balance</span>
      </div>
      <button type="button" class="quota-panel__refresh" :disabled="loading" @click="refresh">
        {{ loading ? "…" : "Refresh" }}
      </button>
    </header>

    <div v-if="providers.length === 0" class="quota-panel__empty">No quoted providers configured.</div>

    <div v-else class="quota-panel__list">
      <section v-for="provider in providers" :key="provider.id" class="provider">
        <header class="provider__head">
          <ProviderLogo :provider-id="provider.id" :model-id="provider.model.id" :size="15" />
          <span class="provider__name">{{ provider.name }}</span>
          <span v-if="loading && !quotaFor(provider.id)" class="provider__status">…</span>
          <span v-else-if="quotaFor(provider.id)?.error" class="provider__status provider__status--error">
            {{ quotaFor(provider.id)?.error }}
          </span>
        </header>

        <div v-if="quotaFor(provider.id) && !quotaFor(provider.id)?.error" class="provider__metrics">
          <div
            v-for="window in quotaFor(provider.id)?.windows ?? []"
            :key="window.label"
            class="quota"
            :class="{ 'quota--bar': hasBar(window) }"
            :data-tone="hasBar(window) ? tone(window.utilization) : undefined"
          >
            <div class="quota__main">
              <span class="quota__label">{{ window.label }}</span>
              <span class="quota__value">
                <template v-if="window.display">
                  {{ window.display }}
                  <span v-if="window.unit" class="quota__unit">{{ window.unit }}</span>
                </template>
                <template v-else-if="typeof window.used === 'number' && typeof window.limit === 'number'">
                  {{ formatNumber(window.used) }} / {{ formatNumber(window.limit) }}
                  <span v-if="window.unit" class="quota__unit">{{ window.unit }}</span>
                </template>
                <template v-if="!window.display && window.utilization > 0">
                  <span class="quota__percent" :class="{ 'quota__percent--padded': typeof window.used === 'number' }">
                    {{ Math.round(window.utilization * 100) }}%
                  </span>
                </template>
              </span>
            </div>
            <div v-if="hasBar(window)" class="quota__track" role="progressbar" :aria-valuenow="Math.round(window.utilization * 100)" aria-valuemin="0" aria-valuemax="100">
              <div class="quota__fill" :style="{ width: `${Math.round(window.utilization * 100)}%` }" />
            </div>
            <span v-if="hasBar(window)" class="quota__reset">resets in {{ formatReset(window.resetsAt) }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.quota-panel { display: flex; flex-direction: column; padding: 5px 6px 6px; }
.quota-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  padding: 0 6px 6px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.quota-panel__title { color: var(--ui-text-muted); font-size: 11px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
.quota-panel__refresh {
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 11px;
}
.quota-panel__refresh:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.quota-panel__refresh:disabled { cursor: default; opacity: 0.55; }
.quota-panel__empty { padding: 14px 6px 8px; color: var(--ui-text-muted); font-size: 12px; }
.quota-panel__list { display: flex; flex-direction: column; }
.provider { padding: 9px 6px 10px; border-bottom: 1px solid var(--ui-border-subtle); }
.provider:last-child { border-bottom: 0; }
.provider__head { display: flex; align-items: center; gap: 7px; min-width: 0; }
.provider__head :deep(.provider-logo) { flex: 0 0 16px; opacity: 0.85; }
.provider__name { overflow: hidden; color: var(--ui-text-strong); font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.provider__status { margin-left: auto; overflow: hidden; color: var(--ui-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.provider__status--error { color: var(--ui-error-strong); }
.provider__metrics { display: flex; flex-direction: column; gap: 7px; margin: 9px 0 0 23px; }
.quota { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.quota__main { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.quota__label { color: var(--ui-text-muted); font-weight: 500; }
.quota__value { color: var(--ui-text-strong); font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 500; }
.quota__unit { color: var(--ui-text-muted); font-weight: 400; }
.quota__percent { color: var(--ui-text-strong); font-variant-numeric: tabular-nums; font-weight: 500; }
.quota__percent--padded { margin-left: 4px; }
.quota__track { height: 4px; overflow: hidden; border-radius: 2px; background: var(--ui-surface-subtle); }
.quota__fill { height: 100%; border-radius: inherit; background: var(--ui-extension-fg); transition: width var(--ui-duration-fast) var(--ui-ease-standard); }
.quota--bar[data-tone="warn"] .quota__fill { background: var(--ui-prompt-fg); }
.quota--bar[data-tone="danger"] .quota__fill { background: var(--ui-error-strong); }
.quota__reset { color: var(--ui-text-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
@media (max-width: 320px) { .provider__metrics { margin-left: 0; } }
</style>
