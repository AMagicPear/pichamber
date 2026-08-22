<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import ArrowDownIcon from "@/assets/icons/ArrowDownS.svg";
import FolderIcon from "lucide-static/icons/folder.svg";
import Modal from "@/components/ui/Modal.vue";
import { browseProjectDirectories, toMessage } from "@/api/client";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ close: []; select: [path: string] }>();

const path = ref("");
const parent = ref<string | null>(null);
const entries = ref<Array<{ name: string; path: string }>>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const pathInput = ref<HTMLInputElement | null>(null);
const selected = ref<string | null>(null);
let requestVersion = 0;

const browse = async (target?: string) => {
  const current = ++requestVersion;
  loading.value = true;
  error.value = null;
  try {
    const result = await browseProjectDirectories(target);
    if (current !== requestVersion) return;
    path.value = result.path;
    parent.value = result.parent;
    entries.value = result.entries;
    selected.value = null;
  } catch (cause) {
    if (current === requestVersion) error.value = toMessage(cause);
  } finally {
    if (current === requestVersion) loading.value = false;
  }
};

watch(
  () => props.show,
  (show) => {
    if (!show) return;
    void browse().then(() => nextTick(() => pathInput.value?.focus()));
  },
);

const choose = () => {
  const target = path.value.trim();
  if (target) emit("select", target);
};
</script>

<template>
  <Modal size="sm" placement="top" :show="show" @close="emit('close')">
    <template #body>
      <div class="project-picker">
        <div class="project-picker__path">
          <button type="button" aria-label="Parent directory" :disabled="!parent" @click="parent && browse(parent)"><ArrowDownIcon /></button>
          <input ref="pathInput" v-model="path" aria-label="Project path" @keydown.enter="browse(path)" />
          <button type="button" class="project-picker__go" aria-label="Browse path" @click="browse(path)">Go</button>
        </div>
        <div class="project-picker__list">
          <button v-for="entry in entries" :key="`${entry.name}:${entry.path}`" type="button" :class="{ 'is-selected': selected === entry.path }" @dblclick="browse(entry.path)" @click="selected = entry.path; path = entry.path">
            <FolderIcon />
            <span>{{ entry.name }}</span>
          </button>
          <p v-if="loading">Loading directories...</p>
          <p v-else-if="error" class="is-error">{{ error }}</p>
          <p v-else-if="entries.length === 0">No subdirectories</p>
        </div>
        <footer>
          <span class="project-picker__hint">Double-click a folder to open it</span>
          <button type="button" class="project-picker__open" :disabled="loading || !path.trim()" @click="choose">Use this folder</button>
          <button type="button" class="project-picker__cancel" @click="emit('close')">Esc</button>
        </footer>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.project-picker { display: grid; width: 100%; gap: 8px; padding: 8px; }
.project-picker__path { display: grid; grid-template-columns: 28px minmax(0, 1fr) 28px; gap: 2px; }
.project-picker__path button,
.project-picker__path input { height: 34px; border: 0; border-bottom: 1px solid var(--ui-border-subtle); border-radius: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; transition: border-color var(--ui-duration-fast) var(--ui-ease-standard), color var(--ui-duration-fast) var(--ui-ease-standard), transform var(--ui-duration-fast) var(--ui-ease-emphasized); }
.project-picker__path button { border-bottom-color: transparent; background: transparent; }
.project-picker__path input { min-width: 0; padding: 0 9px; font-family: var(--ui-font-mono); }
.project-picker__path button { display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; }
.project-picker__path button:hover:not(:disabled) { color: var(--ui-text-strong); transform: translateY(-1px); }
.project-picker__path button:active:not(:disabled) { transform: translateY(0); }
.project-picker__path input:focus,
.project-picker__path button:focus-visible { border-bottom-color: var(--ui-border-focus); outline: none; }
.project-picker__path button:disabled { cursor: default; opacity: 0.35; }
.project-picker__path button:first-child svg { width: 15px; height: 15px; transform: rotate(180deg); }
.project-picker__go { font-size: 11px !important; }
.project-picker__list { min-height: 180px; max-height: 360px; overflow: auto; padding: 2px 0; border: 0; background: transparent; }
.project-picker__list button { display: flex; width: 100%; min-height: 32px; align-items: center; gap: 8px; padding: 5px 7px; border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: color var(--ui-duration-fast) var(--ui-ease-standard); }
.project-picker__list button:hover,
.project-picker__list button:focus { color: var(--ui-text-strong); outline: none; }
.project-picker__list button.is-selected { color: var(--ui-text-strong); font-weight: 500; outline: none; }
.project-picker__list button.is-selected svg { color: var(--ui-text-strong); }
.project-picker__list button.is-selected svg { color: #4e4a43; }
.project-picker__list svg { width: 15px; height: 15px; flex: 0 0 15px; }
.project-picker__list p { margin: 0; padding: 20px 8px; color: #817c73; font-size: 12px; text-align: center; }
.project-picker__list p.is-error { color: #9f4545; }
.project-picker footer { display: flex; align-items: center; gap: 8px; min-height: 22px; padding: 1px 4px 0; }
.project-picker footer button { padding: 2px 4px; border: 0; border-radius: 4px; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 11px; cursor: pointer; }
.project-picker__hint { flex: 1 1 auto; color: var(--ui-text-muted); font-size: 10px; }
.project-picker__cancel:hover,
.project-picker__open:hover:not(:disabled) { background: var(--ui-surface-hover); color: var(--ui-text-strong); }
.project-picker footer button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(74 70 63 / 14%); }
.project-picker__open:disabled { cursor: default; opacity: 0.45; }

@media (prefers-reduced-motion: reduce) {
  .project-picker__path button,
  .project-picker__path input,
  .project-picker__list button { transition: none; }
}
</style>
