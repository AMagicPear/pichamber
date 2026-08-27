<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { SkillsOverview } from "@amagicpear/pichamber-shared";
import { fetchPiSkillsOverview, setPiSkillCommands, setPiSkillEnabled, toMessage } from "@/api/client";
import { workspace } from "@/stores/workspace";
import SettingsGroup from "./SettingsGroup.vue";
import SettingsOption from "./SettingsOption.vue";

const { t } = useI18n();
const overview = ref<SkillsOverview | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const load = async () => {
  const sessionId = workspace.sessionId;
  if (!sessionId) return;
  loading.value = true;
  error.value = null;
  try {
    overview.value = await fetchPiSkillsOverview(sessionId);
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    loading.value = false;
  }
};

const setCommands = async (enabled: boolean) => {
  const sessionId = workspace.sessionId;
  if (!sessionId || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    await setPiSkillCommands(sessionId, enabled);
    await load();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const setSkillEnabled = async (path: string, enabled: boolean) => {
  const sessionId = workspace.sessionId;
  if (!sessionId || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    await setPiSkillEnabled(sessionId, path, enabled);
    await load();
  } catch (cause) {
    error.value = toMessage(cause);
  } finally {
    saving.value = false;
  }
};

const skills = computed(() => overview.value?.skills ?? []);
const disabledSkills = computed(() => overview.value?.disabledSkills ?? []);
const diagnostics = computed(() => overview.value?.diagnostics ?? []);

watch(() => workspace.sessionId, load);
onMounted(load);
</script>

<template>
  <div class="skills-manager">
    <p v-if="error" class="settings-page__error" role="alert">{{ error }}</p>

    <SettingsGroup :title="t('settings.skills.commands')">
      <SettingsOption :title="t('settings.skills.enableCommands')" :description="t('settings.skills.enableCommandsDesc')">
        <input
          :checked="overview?.enableSkillCommands ?? false"
          type="checkbox"
          :disabled="loading || saving || !overview"
          @change="setCommands(($event.target as HTMLInputElement).checked)"
        />
      </SettingsOption>
    </SettingsGroup>

    <SettingsGroup :title="t('settings.skills.discovered')">
      <p v-if="diagnostics.length" class="skills-manager__diagnostics">
        <strong>{{ t('settings.skills.diagnostics') }}</strong>
        <span v-for="diagnostic in diagnostics" :key="`${diagnostic.path}:${diagnostic.error}`">
          <code>{{ diagnostic.path }}</code> - {{ diagnostic.error }}
        </span>
      </p>
      <p v-else-if="loading" class="skills-manager__state">{{ t('settings.skills.loading') }}</p>
      <p v-else-if="!overview?.inventoryAvailable" class="skills-manager__state">{{ t('settings.skills.unavailable') }}</p>
      <p v-else-if="skills.length === 0" class="skills-manager__state">{{ t('settings.skills.none') }}</p>
      <ul v-else class="skills-manager__list">
        <li v-for="skill in skills" :key="skill.path" class="skills-manager__skill">
          <header>
            <strong>{{ skill.name }}</strong>
            <div class="skills-manager__meta">
              <small>{{ t(`settings.skills.scope.${skill.scope}`) }} · {{ t(`settings.skills.origin.${skill.origin}`) }}</small>
              <button type="button" class="skills-manager__disable" :disabled="saving" @click="setSkillEnabled(skill.path, false)">{{ t('settings.skills.disable') }}</button>
            </div>
          </header>
          <p>{{ skill.description }}</p>
          <small v-if="skill.disableModelInvocation" class="skills-manager__explicit">{{ t('settings.skills.modelOnly') }}</small>
          <small class="skills-manager__path" :title="skill.path">{{ skill.path }}</small>
        </li>
      </ul>
    </SettingsGroup>

    <SettingsGroup v-if="disabledSkills.length" :title="t('settings.skills.disabled')">
      <ul class="skills-manager__list">
        <li v-for="skill in disabledSkills" :key="skill.path" class="skills-manager__skill">
          <header>
            <strong>{{ skill.name }}</strong>
            <button type="button" :disabled="saving" @click="setSkillEnabled(skill.path, true)">{{ t('settings.skills.restore') }}</button>
          </header>
          <p v-if="skill.description">{{ skill.description }}</p>
          <small class="skills-manager__path" :title="skill.path">{{ skill.path }}</small>
        </li>
      </ul>
    </SettingsGroup>
  </div>
</template>

<style scoped>
.skills-manager { display: grid; gap: 30px; }
.skills-manager__state { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
.skills-manager__diagnostics { display: grid; gap: 4px; margin: 0 0 12px; padding: 10px 12px; border-left: 3px solid var(--ui-error-strong); border-radius: 4px; background: var(--ui-error-bg); color: var(--ui-error-fg); font-size: 12px; }
.skills-manager__diagnostics strong { font-weight: 600; }
.skills-manager__diagnostics code { font-family: var(--ui-font-mono); overflow-wrap: anywhere; }
.skills-manager__list { margin: 0; padding: 0; border-top: 1px solid var(--ui-border-subtle); list-style: none; }
.skills-manager__skill { display: grid; gap: 5px; border-bottom: 1px solid var(--ui-border-subtle); padding: 10px 0; }
.skills-manager__skill header { display: flex; min-width: 0; align-items: baseline; justify-content: space-between; gap: 12px; }
.skills-manager__skill strong { overflow: hidden; color: var(--ui-text-strong); font-family: var(--ui-font-mono); font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.skills-manager__skill header small, .skills-manager__path, .skills-manager__explicit { color: var(--ui-text-muted); font-size: 11px; }
.skills-manager__meta { display: inline-flex; flex-shrink: 0; align-items: center; gap: 12px; }
.skills-manager__skill p { margin: 0; color: var(--ui-text-muted); font-size: 12px; line-height: 1.45; }
.skills-manager__explicit { color: var(--ui-status-text); }
.skills-manager__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skills-manager__skill button { min-height: 27px; padding: 3px 10px; border-radius: 5px; color: var(--ui-text-muted); font: inherit; font-size: 11px; }
.skills-manager__skill button:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.skills-manager__skill button:disabled { cursor: default; opacity: 0.5; }
.skills-manager__disable:hover:not(:disabled) { background: var(--ui-error-hover) !important; color: var(--ui-error-strong) !important; }
@media (max-width: 640px) { .skills-manager__skill header { align-items: flex-start; flex-direction: column; gap: 5px; } .skills-manager__meta { width: 100%; justify-content: space-between; } }
</style>
