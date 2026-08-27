<script setup lang="ts">
import type { DirEntry, RuntimeSlashCommand } from "@amagicpear/pichamber-shared";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AttachmentIcon from "lucide-static/icons/paperclip.svg";
import CommandIcon from "lucide-static/icons/command.svg";
import { listDirectory, searchFiles, toMessage } from "@/api/client";
import ComposerSurface from "@/components/conversation/composer/ComposerSurface.vue";
import { getEntryIcon } from "@/components/ui/fileIcon";
import { workspace } from "@/stores/workspace";

const { t } = useI18n();

const props = defineProps<{
  mode: "files" | "commands";
  query: string;
  commands: RuntimeSlashCommand[];
}>();

const emit = defineEmits<{
  close: [];
  selectFile: [path: string];
  selectCommand: [command: RuntimeSlashCommand];
}>();

const commandSourceLabel = (source: RuntimeSlashCommand["source"]) =>
  t(`composer.commandSource.${source}`);
const files = ref<DirEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedIndex = ref(0);
let requestVersion = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const commandResults = computed(() => {
  const query = props.query.toLowerCase();
  return props.commands.filter((command) =>
    `${command.name} ${command.description ?? ""}`.toLowerCase().includes(query),
  );
});
const fileResults = computed(() => files.value.filter((entry) => !entry.isDirectory));
const resultCount = computed(() => props.mode === "commands" ? commandResults.value.length : fileResults.value.length);
const title = computed(() => props.mode === "files" ? t("composer.shelfFiles") : t("composer.shelfCommands"));

const runFileSearch = async () => {
  const current = ++requestVersion;
  loading.value = true;
  error.value = null;
  try {
    const query = props.query.trim();
    const entries = query
      ? (await searchFiles(workspace.sessionId, query)).entries
      : (await listDirectory(workspace.sessionId)).entries;
    if (current === requestVersion) files.value = entries;
  } catch (cause) {
    if (current === requestVersion) error.value = toMessage(cause);
  } finally {
    if (current === requestVersion) loading.value = false;
  }
};

watch(
  () => [props.mode, props.query] as const,
  ([mode]) => {
    selectedIndex.value = 0;
    clearTimeout(timer);
    if (mode === "files") timer = setTimeout(() => void runFileSearch(), 120);
  },
  { immediate: true },
);
watch(resultCount, (count) => {
  if (selectedIndex.value >= count) selectedIndex.value = Math.max(0, count - 1);
});

const move = (delta: number) => {
  if (resultCount.value === 0) return;
  selectedIndex.value = (selectedIndex.value + delta + resultCount.value) % resultCount.value;
  nextTick(() => document.querySelector(".composer-suggestions__row.is-selected")?.scrollIntoView({ block: "nearest" }));
};
const choose = () => {
  if (props.mode === "commands") {
    const command = commandResults.value[selectedIndex.value];
    if (command) emit("selectCommand", command);
  } else {
    const entry = fileResults.value[selectedIndex.value];
    if (entry) emit("selectFile", entry.relativePath);
  }
};

defineExpose({ move, choose });
</script>

<template>
  <ComposerSurface class="composer-suggestions" :ariaLabel="title" :closeLabel="t('common.close')" dismissible @close="emit('close')">
    <template #title>
      <span class="composer-suggestions__title">
        <AttachmentIcon v-if="mode === 'files'" />
        <CommandIcon v-else />
        <span>{{ title }}</span>
      </span>
      <span class="composer-suggestions__keys">
        <span>{{ t('composer.upDown') }}</span>
        <span>{{ t('composer.enterInsert') }}</span>
        <span>{{ t('composer.escClose') }}</span>
      </span>
    </template>
    <template #meta><span class="composer-suggestions__hint">{{ mode === "files" ? `@${query}` : `/${query}` }}</span></template>
    <div class="composer-suggestions__body" role="listbox" :aria-label="title">
      <template v-if="mode === 'commands'">
        <button v-for="(command, index) in commandResults" :key="`${command.source}:${command.name}`" type="button"
          class="composer-suggestions__row composer-suggestions__row--command" :class="{ 'is-selected': index === selectedIndex }"
          role="option" :aria-selected="index === selectedIndex" @mouseenter="selectedIndex = index"
          @mousedown.prevent="emit('selectCommand', command)">
          <span class="composer-suggestions__command-copy">
            <span class="composer-suggestions__primary">/{{ command.name }}</span>
            <span class="composer-suggestions__description">{{ command.description || t('composer.noDescription') }}</span>
          </span>
          <span class="composer-suggestions__source" :class="`is-${command.source}`">{{ commandSourceLabel(command.source) }}</span>
        </button>
        <p v-if="commandResults.length === 0" class="composer-suggestions__state">{{ t('composer.noMatchingCommands') }}</p>
      </template>
      <template v-else>
        <button v-for="(entry, index) in fileResults" :key="entry.path" type="button"
          class="composer-suggestions__row composer-suggestions__row--file" :class="{ 'is-selected': index === selectedIndex }"
          role="option" :aria-selected="index === selectedIndex" @mouseenter="selectedIndex = index"
          @mousedown.prevent="emit('selectFile', entry.relativePath)">
          <svg class="composer-suggestions__file-icon" aria-hidden="true"><use :href="getEntryIcon(entry.name, false, false)" /></svg>
          <span class="composer-suggestions__primary">{{ entry.name }}</span>
          <span class="composer-suggestions__description">{{ entry.relativePath }}</span>
        </button>
        <p v-if="loading" class="composer-suggestions__state">{{ t('composer.searchingFiles') }}</p>
        <p v-else-if="error" class="composer-suggestions__state is-error">{{ error }}</p>
        <p v-else-if="fileResults.length === 0" class="composer-suggestions__state">{{ t('composer.noMatchingFiles') }}</p>
      </template>
    </div>
  </ComposerSurface>
</template>

<style scoped>
.composer-suggestions__title { display: inline-flex; min-width: 0; align-items: center; gap: 7px; color: var(--ui-text-muted); font-size: 11px; font-weight: 600; }
.composer-suggestions__title :deep(svg) { width: 14px; height: 14px; flex: 0 0 14px; }
.composer-suggestions__keys { display: inline-flex; align-items: center; gap: 10px; margin-left: 12px; color: var(--ui-text-muted); font-size: 10px; font-weight: 400; white-space: nowrap; }
.composer-suggestions__hint { color: var(--ui-text-muted); font-family: var(--ui-font-mono); font-size: 10px; }
.composer-suggestions__body { display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; min-height: 0; padding: 5px; overflow-x: hidden; overflow-y: auto; }
.composer-suggestions__row { width: 100%; border: 0; border-radius: 6px; background: transparent; color: var(--ui-text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.composer-suggestions__row--command { display: grid; min-height: 43px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 5px 8px 6px 10px; }
.composer-suggestions__row--file { display: grid; min-height: 36px; grid-template-columns: auto minmax(100px, 0.7fr) minmax(0, 1fr); align-items: center; gap: 9px; padding: 5px 8px; }
.composer-suggestions__row.is-selected { background: var(--ui-surface-selected); }
.composer-suggestions__file-icon { width: 15px; height: 15px; flex: 0 0 15px; }
.composer-suggestions__command-copy { display: grid; min-width: 0; gap: 1px; }
.composer-suggestions__primary, .composer-suggestions__description { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-suggestions__primary { font-weight: 500; }
.composer-suggestions__description { color: var(--ui-text-muted); }
.composer-suggestions__row--file .composer-suggestions__description { text-align: right; }
.composer-suggestions__row--command .composer-suggestions__description { font-size: 11px; line-height: 15px; }
.composer-suggestions__source { align-self: center; justify-self: end; padding: 2px 6px; border-radius: 4px; background: var(--ui-surface-selected); color: var(--ui-text-muted); font-size: 10px; line-height: 14px; }
.composer-suggestions__source.is-extension { background: var(--ui-extension-bg); color: var(--ui-extension-fg); }
.composer-suggestions__source.is-skill { background: var(--ui-skill-bg); color: var(--ui-skill-fg); }
.composer-suggestions__source.is-prompt { background: var(--ui-prompt-bg); color: var(--ui-prompt-fg); }
.composer-suggestions__source.is-builtin { background: var(--ui-builtin-bg); color: var(--ui-builtin-fg); }
.composer-suggestions__state { margin: 0; padding: 18px 12px; color: var(--ui-text-muted); font-size: 12px; text-align: center; }
.composer-suggestions__state.is-error { color: #9b4242; }
@media (max-width: 640px) { .composer-suggestions__keys, .composer-suggestions__row--file .composer-suggestions__description { display: none; } .composer-suggestions__row--file { grid-template-columns: auto minmax(0, 1fr); } }
</style>
