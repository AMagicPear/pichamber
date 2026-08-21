<script setup lang="ts">
import type { DirEntry, SlashCommandInfo } from "@amagicpear/pichamber-shared";
import { computed, nextTick, ref, watch } from "vue";
import AttachmentIcon from "@/assets/icons/Attachment2.svg";
import CommandIcon from "@/assets/icons/Command.svg";
import { listDirectory, searchFiles, toMessage } from "@/api/client";
import { getEntryIcon } from "@/components/ui/fileIcon";
import { workspace } from "@/stores/workspace";
import FloatingPanel from "../../ui/FloatingPanel.vue";

const props = defineProps<{
  mode: "files" | "commands" | null;
  query: string;
  commands: SlashCommandInfo[];
}>();

const emit = defineEmits<{
  selectFile: [path: string];
  selectCommand: [command: SlashCommandInfo];
}>();

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

const fileResults = computed(() => files.value.filter((entry) => !entry.isDirectory).slice(0, 10));
const resultCount = computed(() =>
  props.mode === "commands" ? commandResults.value.length : fileResults.value.length,
);

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
  nextTick(() => document.querySelector(".composer-shelf__row.is-selected")?.scrollIntoView({ block: "nearest" }));
};

const choose = () => {
  if (props.mode === "commands") {
    const command = commandResults.value[selectedIndex.value];
    if (command) emit("selectCommand", command);
  } else if (props.mode === "files") {
    const entry = fileResults.value[selectedIndex.value];
    if (entry) emit("selectFile", entry.relativePath);
  }
};

defineExpose({ move, choose });
</script>

<template>
  <FloatingPanel
    v-if="mode"
    :title="mode === 'files' ? 'Files' : 'Pi commands'"
    :hint="mode === 'files' ? `@${query}` : `/${query}`"
    :aria-label="mode === 'files' ? 'Files' : 'Commands'"
    role="listbox"
  >
    <template #title-icon>
      <AttachmentIcon v-if="mode === 'files'" />
      <CommandIcon v-else />
    </template>
    <template v-if="mode === 'commands'">
      <button
        v-for="(command, index) in commandResults"
        :key="`${command.source}:${command.name}`"
        type="button"
        class="composer-shelf__row composer-shelf__row--command"
        :class="{ 'is-selected': index === selectedIndex }"
        role="option"
        :aria-selected="index === selectedIndex"
        @mouseenter="selectedIndex = index"
        @mousedown.prevent="emit('selectCommand', command)"
      >
        <span class="composer-shelf__command-copy">
          <span class="composer-shelf__primary">/{{ command.name }}</span>
          <span class="composer-shelf__description">{{ command.description || "No description" }}</span>
        </span>
        <span class="composer-shelf__source" :class="`is-${command.source}`">{{ command.source }}</span>
      </button>
      <p v-if="commandResults.length === 0" class="composer-shelf__state">No matching Pi commands</p>
    </template>
    <template v-else>
      <button
        v-for="(entry, index) in fileResults"
        :key="entry.path"
        type="button"
        class="composer-shelf__row composer-shelf__row--file"
        :class="{ 'is-selected': index === selectedIndex }"
        role="option"
        :aria-selected="index === selectedIndex"
        @mouseenter="selectedIndex = index"
        @mousedown.prevent="emit('selectFile', entry.relativePath)"
      >
        <svg class="composer-shelf__file-icon" aria-hidden="true"><use :href="getEntryIcon(entry.name, false, false)" /></svg>
        <span class="composer-shelf__primary">{{ entry.name }}</span>
        <span class="composer-shelf__description">{{ entry.relativePath }}</span>
      </button>
      <p v-if="loading" class="composer-shelf__state">Searching files...</p>
      <p v-else-if="error" class="composer-shelf__state is-error">{{ error }}</p>
      <p v-else-if="fileResults.length === 0" class="composer-shelf__state">No matching files</p>
    </template>
    <template #footer>
      Up/Down to navigate <span>Enter to insert</span> <span>Esc to close</span>
    </template>
  </FloatingPanel>
</template>

<style scoped>
.composer-shelf__row {
  width: 100%;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.composer-shelf__row--command {
  display: grid;
  min-height: 43px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 5px 8px 6px 10px;
}
.composer-shelf__row--file {
  display: grid;
  min-height: 36px;
  grid-template-columns: auto minmax(100px, 0.7fr) minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 5px 8px;
}
.composer-shelf__row.is-selected {
  background: var(--ui-surface-selected);
}
.composer-shelf__file-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}
.composer-shelf__command-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}
.composer-shelf__primary {
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-shelf__description {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-shelf__row--command .composer-shelf__description {
  font-size: 11px;
  line-height: 15px;
}
.composer-shelf__source {
  align-self: center;
  justify-self: end;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--ui-surface-selected);
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 14px;
}
.composer-shelf__source.is-extension { background: var(--ui-extension-bg); color: var(--ui-extension-fg); }
.composer-shelf__source.is-skill { background: var(--ui-skill-bg); color: var(--ui-skill-fg); }
.composer-shelf__source.is-prompt { background: var(--ui-prompt-bg); color: var(--ui-prompt-fg); }
.composer-shelf__source.is-builtin { background: var(--ui-builtin-bg); color: var(--ui-builtin-fg); }
.composer-shelf__state {
  margin: 0;
  padding: 18px 12px;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-align: center;
}
.composer-shelf__state.is-error { color: #9b4242; }
@media (max-width: 640px) {
  .composer-shelf__row--file .composer-shelf__description { display: none; }
  .composer-shelf__row--file { grid-template-columns: auto minmax(0, 1fr); }
}
</style>