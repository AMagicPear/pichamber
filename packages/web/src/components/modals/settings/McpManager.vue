<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { McpOverview } from "@amagicpear/pichamber-shared";
import { fetchPiMcpOverview, reconnectPiMcpServer, setPiMcpServerEnabled, toMessage } from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import CommandButton from "@/components/ui/CommandButton.vue";

const { t } = useI18n();
const overview = ref<McpOverview | null>(null);
const saving = ref(false);
const expanded = ref<string | null>(null);
const error = ref<string | null>(null);
const load = async () => { if (!workspace.sessionId) return; try { overview.value = await fetchPiMcpOverview(workspace.sessionId); error.value = overview.value.error ?? null; } catch (cause) { error.value = toMessage(cause); } };
const setEnabled = async (name: string, enabled: boolean) => { if (!workspace.sessionId || saving.value) return; saving.value = true; try { overview.value = await setPiMcpServerEnabled(workspace.sessionId, name, enabled); } catch (cause) { error.value = toMessage(cause); } finally { saving.value = false; } };
const reconnect = async (name: string) => { if (!workspace.sessionId || saving.value) return; saving.value = true; error.value = null; try { overview.value = await reconnectPiMcpServer(workspace.sessionId, name); expanded.value = name; } catch (cause) { error.value = toMessage(cause); } finally { saving.value = false; } };
const servers = computed(() => overview.value?.servers ?? []);
watch(() => workspace.sessionId, load);
onMounted(load);
</script>

<template>
  <div class="mcp-manager">
    <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>
    <div class="mcp-manager__provider"><strong>pi-mcp-adapter</strong><span>{{ t('settings.mcp.provider') }}</span></div>
    <SettingsGroup :title="t('settings.mcp.servers')">
      <p v-if="overview && !overview.available" class="mcp-manager__state">{{ t('settings.mcp.unavailable') }}</p>
      <p v-else-if="overview && servers.length === 0" class="mcp-manager__state">{{ t('settings.mcp.none') }}</p>
      <ul v-else class="mcp-manager__list">
        <li v-for="server in servers" :key="server.name" class="mcp-manager__server">
          <header><strong>{{ server.name }}</strong><span :class="`is-${server.status}`">{{ t(`settings.mcp.status.${server.status}`) }}</span></header>
          <div class="mcp-manager__details"><small>{{ t(`settings.mcp.transport.${server.transport}`) }}</small><small>{{ t('settings.mcp.tools', { count: server.toolCount }) }}</small><small v-if="server.resourceCount">{{ t('settings.mcp.resources', { count: server.resourceCount }) }}</small><small v-if="server.promptCount">{{ t('settings.mcp.prompts', { count: server.promptCount }) }}</small><small v-if="server.directTools">{{ t('settings.mcp.directTools') }}</small></div>
          <small v-if="server.source" class="mcp-manager__path" :title="server.source">{{ server.source }}</small>
          <div class="mcp-manager__actions"><CommandButton v-if="!server.disabled" variant="compact" :disabled="saving" @click="reconnect(server.name)">{{ t('settings.mcp.refresh') }}</CommandButton><CommandButton v-if="server.tools.length || server.resources.length || server.prompts.length" variant="compact" :disabled="saving" @click="expanded = expanded === server.name ? null : server.name">{{ t(expanded === server.name ? 'settings.mcp.hideDetails' : 'settings.mcp.showDetails') }}</CommandButton><CommandButton variant="compact" :danger="!server.disabled" :disabled="saving" @click="setEnabled(server.name, server.disabled)">{{ t(server.disabled ? 'settings.mcp.restore' : 'settings.mcp.disable') }}</CommandButton></div>
          <div v-if="expanded === server.name" class="mcp-manager__catalog"><template v-for="group in [{ key: 'tools', items: server.tools }, { key: 'resources', items: server.resources }, { key: 'prompts', items: server.prompts }]" :key="group.key"><section v-if="group.items.length"><small>{{ t(`settings.mcp.${group.key}Title`) }}</small><ul><li v-for="item in group.items" :key="item.name"><strong>{{ item.name }}</strong><span v-if="item.description">{{ item.description }}</span></li></ul></section></template></div>
        </li>
      </ul>
    </SettingsGroup>
  </div>
</template>

<style scoped>
.mcp-manager { display: grid; gap: 30px; }.mcp-manager__provider { display:flex; gap:8px; align-items:baseline; color:var(--ui-text-muted); font-size:12px; }.mcp-manager__provider strong { color:var(--ui-text-strong); font-family:var(--ui-font-mono); font-weight:500; }.mcp-manager__state { margin: 0; color: var(--ui-text-muted); font-size: 12px; }.mcp-manager__list { margin: 0; padding: 0; border-top: 1px solid var(--ui-border-subtle); list-style: none; }.mcp-manager__server { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; border-bottom: 1px solid var(--ui-border-subtle); padding: 11px 0; }.mcp-manager__server header { display: flex; min-width: 0; align-items: center; gap: 8px; }.mcp-manager__server strong { overflow: hidden; color: var(--ui-text-strong); font-family: var(--ui-font-mono); font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }.mcp-manager__server header span { flex: 0 0 auto; color: var(--ui-text-muted); font-size: 11px; }.mcp-manager__server header .is-cached { color: var(--ui-status-text); }.mcp-manager__details { display: flex; flex-wrap: wrap; gap: 4px 10px; }.mcp-manager__details small, .mcp-manager__path { color: var(--ui-text-muted); font-size: 11px; }.mcp-manager__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.mcp-manager__actions { grid-column:2; grid-row:1 / span 3; display:flex; align-self:center; gap:4px; }.mcp-manager__catalog { grid-column:1 / -1; display:grid; gap:10px; margin-top:4px; padding:10px; background:var(--ui-surface-hover); }.mcp-manager__catalog section { display:grid; gap:5px; }.mcp-manager__catalog section>small { color:var(--ui-text-muted); font-size:11px; }.mcp-manager__catalog ul { display:grid; gap:4px; margin:0; padding:0; list-style:none; }.mcp-manager__catalog li { display:grid; gap:2px; }.mcp-manager__catalog li strong { font-size:11px; }.mcp-manager__catalog li span { color:var(--ui-text-muted); font-size:11px; line-height:1.4; }@media (max-width:640px){.mcp-manager__server{grid-template-columns:minmax(0,1fr)}.mcp-manager__actions{grid-column:1;grid-row:auto}.mcp-manager__catalog{grid-column:1}}
</style>
