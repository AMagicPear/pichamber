<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { fetchDiagnosticsServer, type DiagnosticsServerResponse } from "@/api/client";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsPageHeader from "./SettingsPageHeader.vue";
import CommandButton from "@/components/ui/CommandButton.vue";
import { getDiagnostics } from "@/diagnostics/browser-events";
import type { DiagnosticEvent } from "@amagicpear/pichamber-shared";

const { t } = useI18n();

const browserCount = ref<number | null>(null);
const serverInfo = ref<DiagnosticsServerResponse | null>(null);
const exporting = ref(false);
const clearing = ref(false);
const error = ref<string | null>(null);

const refresh = async () => {
  try {
    const handle = await getDiagnostics();
    browserCount.value = await handle.store.count();
    serverInfo.value = await fetchDiagnosticsServer(500);
  } catch (cause) {
    error.value = String(cause);
  }
};

onMounted(refresh);

/** Build a single combined JSON report and trigger a browser download. */
const exportReport = async () => {
  exporting.value = true;
  error.value = null;
  try {
    const handle = await getDiagnostics();
    const browser = await handle.store.tail();
    const server = serverInfo.value ?? (await fetchDiagnosticsServer(500));
    const report = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sources: { browser: true, server: true },
      environment: {
        userAgent: navigator.userAgent,
        language: navigator.language,
      },
      browserEvents: browser,
      serverEvents: server.events,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pichamber-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (cause) {
    error.value = String(cause);
  } finally {
    exporting.value = false;
  }
};

const clearBrowser = async () => {
  clearing.value = true;
  error.value = null;
  try {
    const handle = await getDiagnostics();
    await handle.store.clear();
    await refresh();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    clearing.value = false;
  }
};

const formatCount = (n: number | null): string => (n === null ? "—" : n.toLocaleString());

const summariseLevel = (events: DiagnosticEvent[]): string => {
  const tally: Record<string, number> = {};
  for (const event of events) {
    tally[event.level] = (tally[event.level] ?? 0) + 1;
  }
  return Object.entries(tally)
    .sort(([, a], [, b]) => b - a)
    .map(([level, count]) => `${level}=${count}`)
    .join(", ") || "—";
};
</script>

<template>
  <SettingsPageHeader :title="t('settings.diagnostics.title')" :description="t('settings.diagnostics.description')" />
  <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>

  <SettingsGroup :title="t('settings.diagnostics.localState')">
    <dl class="diagnostics-summary">
      <div class="diagnostics-summary__row">
        <dt>{{ t('settings.diagnostics.browserEvents') }}</dt>
        <dd><strong>{{ formatCount(browserCount) }}</strong><small>{{ t('settings.diagnostics.browserEventsDesc') }}</small></dd>
      </div>
      <div class="diagnostics-summary__row">
        <dt>{{ t('settings.diagnostics.serverEvents') }}</dt>
        <dd><strong>{{ serverInfo ? formatCount(serverInfo.events.length) : "—" }}</strong><small>{{ t('settings.diagnostics.serverEventsDesc') }}<template v-if="serverInfo?.events.length"> · {{ summariseLevel(serverInfo.events as DiagnosticEvent[]) }}</template></small></dd>
      </div>
      <div class="diagnostics-summary__row">
        <dt>{{ t('settings.diagnostics.serverLogDir') }}</dt>
        <dd><code class="diagnostics-path">{{ serverInfo?.directory ?? "—" }}</code><small>{{ t('settings.diagnostics.serverLogDirDesc') }}</small></dd>
      </div>
    </dl>
  </SettingsGroup>

  <SettingsGroup :title="t('settings.diagnostics.actions')">
    <div class="diagnostics-actions">
      <div class="diagnostics-actions__row">
        <div><strong>{{ t('settings.diagnostics.exportTitle') }}</strong><small>{{ t('settings.diagnostics.exportDesc') }}</small></div>
        <CommandButton :disabled="exporting" @click="exportReport">{{ exporting ? t('settings.diagnostics.exporting') : t('settings.diagnostics.exportAction') }}</CommandButton>
      </div>
      <div class="diagnostics-actions__row">
        <div><strong>{{ t('settings.diagnostics.clearTitle') }}</strong><small>{{ t('settings.diagnostics.clearDesc') }}</small></div>
        <CommandButton danger :disabled="clearing" @click="clearBrowser">{{ clearing ? t('settings.diagnostics.clearing') : t('settings.diagnostics.clearAction') }}</CommandButton>
      </div>
    </div>
  </SettingsGroup>

  <p class="diagnostics-privacy" role="note">{{ t('settings.diagnostics.privacy') }}</p>
</template>

<style scoped>
.diagnostics-summary { display: grid; gap: 0; margin: 4px 0 0; }
.diagnostics-summary__row { display: grid; grid-template-columns: 156px minmax(0, 1fr); gap: 16px; padding: 9px 0; }
.diagnostics-summary dt { color: var(--ui-text-strong); font-size: 12px; font-weight: 500; }
.diagnostics-summary dd { display: grid; min-width: 0; gap: 3px; margin: 0; }
.diagnostics-summary dd > strong { color: var(--ui-text); font-size: 14px; font-variant-numeric: tabular-nums; font-weight: 500; }
.diagnostics-summary dd > small { color: var(--ui-text-muted); font-size: 11px; line-height: 1.45; }
.diagnostics-path {
  display: inline-block;
  max-width: 360px;
  overflow-wrap: anywhere;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--ui-surface-muted);
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--ui-text-muted);
}
.diagnostics-actions { display: grid; gap: 0; margin-top: 4px; }
.diagnostics-actions__row { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 20px; padding: 9px 0; }
.diagnostics-actions__row > div { display: grid; min-width: 0; gap: 3px; }
.diagnostics-actions__row strong { color: var(--ui-text-strong); font-size: 13px; font-weight: 500; }
.diagnostics-actions__row small { color: var(--ui-text-muted); font-size: 12px; line-height: 1.45; }
.diagnostics-privacy {
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 6px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
}
@media (max-width: 640px) {
  .diagnostics-summary__row { grid-template-columns: 1fr; gap: 4px; }
  .diagnostics-actions__row { align-items: flex-start; flex-direction: column; gap: 7px; }
}
</style>
