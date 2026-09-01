<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ExtensionsOverview, PiBuiltinExtension, PiExtensionSource, PiExtensionUpdate, PiMarketplacePackage, PiMarketplaceResult } from "@amagicpear/pichamber-shared";
import {
  checkPiExtensionUpdates,
  fetchPiExtensionsOverview,
  fetchPiMarketplace,
  installPiExtensionSource,
  removePiExtensionSource,
  setPiBuiltinExtension,
  toMessage,
  updatePiExtensions,
} from "@/api/client";
import { formatDownloads, formatRelativeDate, normalizePiMarketplace } from "@/utils/marketplace";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsSelect from "./SettingsSelect.vue";
import SearchBox from "@/components/ui/SearchBox.vue";
import CommandButton from "@/components/ui/CommandButton.vue";

const { t, locale } = useI18n();

const overview = ref<ExtensionsOverview | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const saving = ref(false);
const checkingUpdates = ref(false);
const updates = ref<PiExtensionUpdate[]>([]);
const updatesChecked = ref(false);

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
    updates.value = (await checkPiExtensionUpdates(sessionId)).updates.filter((update) => update.scope === "user");
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

const updateAllPackages = async () => {
  for (const update of updates.value) await updatePackages(update.source);
  await checkUpdates();
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

const marketName = ref("");
const marketType = ref("");
const marketSort = ref("downloads");
const marketPage = ref(1);
const marketResult = ref<PiMarketplaceResult | null>(null);
const marketLoading = ref(false);
const marketError = ref<string | null>(null);

const marketTotalPages = computed(() => Math.max(1, Math.ceil((marketResult.value?.total ?? 0) / 50)));

const searchMarket = async () => {
  marketLoading.value = true;
  marketError.value = null;
  try {
    marketResult.value = normalizePiMarketplace(
      await fetchPiMarketplace({
        name: marketName.value.trim(),
        type: marketType.value,
        sort: marketSort.value,
        page: marketPage.value,
      }),
    );
  } catch (cause) {
    marketError.value = toMessage(cause);
    marketResult.value = null;
  } finally {
    marketLoading.value = false;
  }
};

const installMarket = async (pkg: PiMarketplacePackage) => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  saving.value = true;
  marketError.value = null;
  error.value = null;
  try {
    await installPiExtensionSource(sessionId, pkg.source, "user");
    await load();
  } catch (cause) {
    marketError.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

/* ---- Custom source: paste a git:/URL/path (or npm:) spec directly. */
const customSource = ref("");

const addCustomSource = async () => {
  const sessionId = workspace.sessionId;
  const value = customSource.value.trim();
  if (!sessionId || !value) return;
  saving.value = true;
  error.value = null;
  try {
    await installPiExtensionSource(sessionId, value, "user");
    customSource.value = "";
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

const builtins = computed(() => overview.value?.builtins ?? []);
const sources = computed(() => (overview.value?.sources ?? []).filter((entry) => entry.scope === "user"));

const isMarketPackageInstalled = (pkg: PiMarketplacePackage) => sources.value.some((entry) => {
  const source = entry.source.replace(/^npm:/, "");
  return source === pkg.name || source.startsWith(`${pkg.name}@`);
});

watch(() => workspace.sessionId, async () => {
  updates.value = [];
  updatesChecked.value = false;
  await load();
  await checkUpdates();
});
onMounted(async () => {
  await load();
  await checkUpdates();
  await searchMarket();
});
</script>

<template>
  <div class="extension-manager">
    <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>

    <SettingsGroup :title="t('settings.extensions.installedExtensions')" class="extension-manager__installed">
      <p class="extension-manager__hint">{{ t('settings.extensions.installedHint') }}</p>

      <div class="extension-manager__subheading">{{ t('settings.extensions.packageSources') }}</div>
      <div class="extension-manager__update-bar">
        <span>
          <strong v-if="updates.length">{{ t('settings.extensions.updatesAvailable', { count: updates.length }) }}</strong>
          <span v-else-if="checkingUpdates">{{ t('settings.extensions.checkingUpdates') }}</span>
          <span v-else-if="updatesChecked">{{ t('settings.extensions.noUpdatesAvailable') }}</span>
          <span v-else>{{ t('settings.extensions.updatesNotChecked') }}</span>
        </span>
        <div class="extension-manager__actions">
          <CommandButton variant="compact" :disabled="saving || checkingUpdates" @click="checkUpdates">{{ t('settings.extensions.checkAgain') }}</CommandButton>
          <CommandButton v-if="updates.length" variant="compact" :disabled="saving || checkingUpdates" @click="updateAllPackages">
            {{ t('settings.extensions.updateAll') }}
          </CommandButton>
        </div>
      </div>
      <p v-if="!loading && sources.length === 0" class="extension-manager__state">{{ t('settings.extensions.noSources') }}</p>
      <ul v-else class="extension-manager__list">
        <li v-for="entry in sources" :key="`${entry.scope}:${entry.source}`" class="extension-manager__manage-row">
          <div class="extension-manager__item-copy">
            <strong>{{ entry.source }} <small v-if="entry.version">v{{ entry.version }}</small></strong>
            <small>
              <template v-if="updates.some((update) => update.source === entry.source && update.scope === entry.scope)"> {{ t('settings.extensions.updateAvailable') }}</template>
              <template v-if="entry.filtered"> · {{ t('settings.extensions.filtered') }}</template>
              <template v-if="entry.installedPath"> · {{ entry.installedPath }}</template>
            </small>
          </div>
          <div class="extension-manager__actions">
            <CommandButton
              v-if="updates.some((update) => update.source === entry.source && update.scope === entry.scope)"
              variant="compact"
              :disabled="saving || checkingUpdates"
              @click="updatePackages(entry.source)"
            >{{ t('common.update') }}</CommandButton>
            <CommandButton variant="compact" danger :disabled="saving" @click="removeSource(entry)">{{ t('common.remove') }}</CommandButton>
          </div>
        </li>
      </ul>

      <div class="extension-manager__subheading extension-manager__subheading--spaced">{{ t('settings.extensions.builtinExtensions') }}</div>
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
              <CommandButton variant="compact" :disabled="saving" @click="install(ext)">{{ t('common.update') }}</CommandButton>
              <CommandButton variant="compact" danger :disabled="saving" @click="remove(ext)">{{ t('common.remove') }}</CommandButton>
            </template>
            <CommandButton v-else variant="compact" :disabled="saving" @click="install(ext)">{{ t('settings.extensions.configure') }}</CommandButton>
          </div>
        </li>
      </ul>
    </SettingsGroup>

    <SettingsGroup :title="t('settings.extensions.installExtensions')" class="extension-manager__install">
      <p class="extension-manager__hint">
        <i18n-t keypath="settings.extensions.installHint" tag="span">
          <template #link><a href="https://pi.dev/packages" target="_blank" rel="noopener noreferrer">pi.dev/packages</a></template>
        </i18n-t>
      </p>

      <div class="extension-manager__market-toolbar">
        <SearchBox
          v-model="marketName"
          type="search"
          size="compact"
          :disabled="marketLoading"
          :placeholder="t('settings.extensions.searchPlaceholder')"
          :label="t('settings.extensions.searchLabel')"
          @enter="searchMarket"
        />
        <SettingsSelect v-model="marketType" :disabled="marketLoading" :aria-label="t('settings.extensions.marketType')" @change="searchMarket">
          <option value="">{{ t('settings.extensions.allTypes') }}</option>
          <option value="extension">{{ t('settings.extensions.type.extension') }}</option>
          <option value="skill">{{ t('settings.extensions.type.skill') }}</option>
          <option value="theme">{{ t('settings.extensions.type.theme') }}</option>
          <option value="prompt">{{ t('settings.extensions.type.prompt') }}</option>
        </SettingsSelect>
        <SettingsSelect v-model="marketSort" :disabled="marketLoading" :aria-label="t('settings.extensions.marketSort')" @change="searchMarket">
          <option value="downloads">{{ t('settings.extensions.sortDownloads') }}</option>
          <option value="recent">{{ t('settings.extensions.sortRecent') }}</option>
          <option value="name">{{ t('settings.extensions.sortName') }}</option>
        </SettingsSelect>
        <CommandButton variant="outline" :disabled="marketLoading" @click="searchMarket">{{ t('settings.extensions.searchMarket') }}</CommandButton>
      </div>

      <div class="extension-manager__market-status">
        <span v-if="marketResult" class="extension-manager__market-count">
          {{ t('settings.extensions.resultsCount', { count: marketResult.total }) }}
          <small class="extension-manager__market-source">
            {{ t(`settings.extensions.sourceBadge.${marketResult.source === 'pi.dev' ? 'piDev' : 'npm'}`) }}
          </small>
        </span>
        <span v-else-if="marketLoading">{{ t('settings.extensions.loading') }}</span>
      </div>
      <p v-if="marketError" class="extension-manager__market-error" role="alert">{{ marketError }}</p>
      <p v-else-if="marketLoading" class="extension-manager__state">{{ t('settings.extensions.loading') }}</p>
      <p v-else-if="marketResult && marketResult.packages.length === 0" class="extension-manager__state">{{ t('settings.extensions.empty') }}</p>
      <ul v-else-if="marketResult" class="extension-manager__list extension-manager__market-list">
        <li v-for="pkg in marketResult.packages" :key="pkg.source" class="extension-manager__market-row">
          <div class="extension-manager__item-copy">
            <strong>{{ pkg.name }}</strong>
            <small class="extension-manager__market-desc">{{ pkg.description }}</small>
            <div class="extension-manager__market-meta">
              <span v-if="pkg.author">{{ pkg.author }}</span>
              <span v-if="pkg.downloads">{{ formatDownloads(pkg.downloads) }}</span>
              <span v-if="pkg.date">{{ formatRelativeDate(pkg.date, locale) }}</span>
            </div>
            <div v-if="pkg.types.length" class="extension-manager__resources">
              <code v-for="type in pkg.types" :key="type">{{ t(`settings.extensions.type.${type}`) }}</code>
            </div>
          </div>
          <div class="extension-manager__actions">
            <CommandButton
              variant="compact"
              :disabled="saving || marketLoading || isMarketPackageInstalled(pkg)"
              @click="installMarket(pkg)"
            >
              {{ isMarketPackageInstalled(pkg) ? t('settings.extensions.installed') : t('settings.extensions.installAction') }}
            </CommandButton>
          </div>
        </li>
      </ul>
      <div v-if="marketResult && marketTotalPages > 1" class="extension-manager__market-pager">
        <CommandButton variant="compact" :disabled="marketLoading || marketPage <= 1" @click="marketPage--; searchMarket()">← {{ t('settings.extensions.prev') }}</CommandButton>
        <span>{{ marketPage }} / {{ marketTotalPages }}</span>
        <CommandButton variant="compact" :disabled="marketLoading || marketPage >= marketTotalPages" @click="marketPage++; searchMarket()">{{ t('settings.extensions.next') }} →</CommandButton>
      </div>

      <div class="extension-manager__custom">
        <div class="extension-manager__custom-head">
          <strong>{{ t('settings.extensions.addCustomSource') }}</strong>
          <small>{{ t('settings.extensions.addCustomSourceDesc') }}</small>
        </div>
        <div class="extension-manager__add">
          <SearchBox
            v-model="customSource"
            type="text"
            size="compact"
            :disabled="saving"
            :placeholder="t('settings.extensions.customSourcePlaceholder')"
            :label="t('settings.extensions.customSourceLabel')"
            @enter="addCustomSource"
          />
          <CommandButton variant="compact" :disabled="saving || !customSource.trim()" @click="addCustomSource">{{ t('common.add') }}</CommandButton>
        </div>
        <p class="extension-manager__hint">{{ t('settings.extensions.customSourceHint') }}</p>
      </div>
    </SettingsGroup>

  </div>
</template>

<style scoped>
.extension-manager { display: grid; gap: 30px; }
.extension-manager__hint { margin: 0 0 10px; color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
.extension-manager__hint a { color: inherit; text-decoration: underline; text-decoration-color: var(--ui-border); text-underline-offset: 2px; }
.extension-manager__hint a:hover { color: var(--ui-text-strong); }
.extension-manager__hint code { color: var(--ui-text-strong); font-family: var(--ui-font-mono); }
.extension-manager__state { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
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
.extension-manager__installed .extension-manager__item-copy > small { line-height: 1.45; overflow: visible; text-overflow: clip; white-space: normal; }
.extension-manager__actions { display: flex; flex-shrink: 0; gap: 4px; }
.extension-manager__resources { display: flex; flex-wrap: wrap; gap: 4px; }
.extension-manager__resources code { padding: 2px 5px; border-radius: 4px; background: var(--ui-accent-soft); color: var(--ui-accent-text); font-size: 10px; overflow-wrap: anywhere; }
.extension-manager__add { display: flex; align-items: center; gap: 5px; }
.extension-manager__add > .search-box { width: 260px; flex: 0 0 auto; }
.extension-manager__update-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; color: var(--ui-text-muted); font-size: 12px; }
.extension-manager__update-bar strong { color: var(--ui-status-text); font-weight: 600; }
.extension-manager__custom { display: grid; gap: 10px; margin-top: 22px; padding-top: 20px; border-top: 1px dashed var(--ui-border-subtle); }
.extension-manager__custom-head { display: grid; gap: 3px; }
.extension-manager__custom-head strong { color: var(--ui-text-strong); font-size: 12px; font-weight: 500; }
.extension-manager__custom-head small { color: var(--ui-text-muted); font-size: 11px; }
.extension-manager__subheading { color: var(--ui-text-strong); font-size: 12px; font-weight: 500; }
.extension-manager__subheading--spaced { margin-top: 18px; }
.extension-manager__market-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.extension-manager__market-toolbar > .search-box { width: 240px; flex: 1 1 240px; }
.extension-manager__market-toolbar > .settings-select { flex: 0 0 auto; }
.extension-manager__market-status { display: flex; min-height: 20px; align-items: center; margin: 4px 0 8px; color: var(--ui-text-muted); font-size: 11px; }
.extension-manager__market-count { display: inline-flex; align-items: baseline; gap: 6px; }
.extension-manager__market-source { color: var(--ui-accent-text); font-family: var(--ui-font-mono); }
.extension-manager__market-error {
  display: grid;
  gap: 4px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--ui-error-strong);
  border-radius: 4px;
  background: var(--ui-error-bg);
  color: var(--ui-error-fg);
  font-size: 12px;
}
.extension-manager__market-row { display: flex; min-height: 60px; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--ui-border-subtle); padding: 8px 0; }
.extension-manager__market-desc { overflow: visible; text-overflow: clip; white-space: normal; line-height: 1.45; }
.extension-manager__market-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--ui-text-muted); font-size: 11px; }
.extension-manager__market-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 10px; color: var(--ui-text-muted); font-size: 12px; }
.extension-manager__market-pager span { min-width: 56px; text-align: center; }
@media (max-width: 640px) {
  .extension-manager__market-row { flex-wrap: wrap; }
  .extension-manager__market-toolbar > .search-box { flex-basis: 100%; }
  .extension-manager__manage-row { flex-wrap: wrap; }
  .extension-manager__actions { width: 100%; }
  .extension-manager__add { width: 100%; flex-wrap: wrap; }
  .extension-manager__add > .search-box { flex: 1 1 100%; width: 100%; }
}
</style>
