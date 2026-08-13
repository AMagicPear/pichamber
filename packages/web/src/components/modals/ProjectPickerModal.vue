<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import ArrowDownIcon from "@/assets/icons/ArrowDownS.svg";
import FolderIcon from "@/assets/icons/Folder.svg";
import Modal from "@/components/layout/Modal.vue";
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
  <Modal size="sm" :show="show" @close="emit('close')">
    <template #body>
      <div class="project-picker">
        <header>
          <span>New project</span>
          <h3>Choose a working directory</h3>
        </header>
        <div class="project-picker__path">
          <button type="button" aria-label="Parent directory" :disabled="!parent" @click="parent && browse(parent)"><ArrowDownIcon /></button>
          <input ref="pathInput" v-model="path" aria-label="Project path" @keydown.enter="browse(path)" />
          <button type="button" class="project-picker__go" @click="browse(path)">Go</button>
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
          <button type="button" class="project-picker__cancel" @click="emit('close')">Cancel</button>
          <button type="button" class="project-picker__open" :disabled="loading || !path.trim()" @click="choose">Open project</button>
        </footer>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.project-picker { display: grid; width: 100%; gap: 13px; }
.project-picker header { display: grid; gap: 4px; }
.project-picker header span { color: #767168; font-size: 10px; font-weight: 600; text-transform: uppercase; }
.project-picker h3 { margin: 0; color: var(--ui-text-strong); font-size: 16px; font-weight: 600; }
.project-picker__path { display: grid; grid-template-columns: 32px minmax(0, 1fr) 36px; gap: 5px; }
.project-picker__path button,
.project-picker__path input { height: 34px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-surface); color: inherit; font: inherit; font-size: 12px; transition: border-color var(--ui-duration-fast) var(--ui-ease-standard), background-color var(--ui-duration-fast) var(--ui-ease-standard), box-shadow var(--ui-duration-fast) var(--ui-ease-standard); }
.project-picker__path input { min-width: 0; padding: 0 9px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.project-picker__path button { display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; }
.project-picker__path button:hover:not(:disabled) { background: var(--ui-surface-hover); }
.project-picker__path input:focus,
.project-picker__path button:focus-visible { border-color: #aaa59b; outline: none; box-shadow: 0 0 0 2px rgb(74 70 63 / 10%); }
.project-picker__path button:disabled { cursor: default; opacity: 0.35; }
.project-picker__path button:first-child svg { width: 15px; height: 15px; transform: rotate(180deg); }
.project-picker__go { font-size: 11px !important; }
.project-picker__list { min-height: 150px; max-height: 260px; overflow: auto; padding: 4px; border: 1px solid var(--ui-border-subtle); border-radius: 7px; background: var(--ui-surface-subtle); }
.project-picker__list button { display: flex; width: 100%; min-height: 32px; align-items: center; gap: 8px; padding: 5px 7px; border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: background-color var(--ui-duration-fast) var(--ui-ease-standard); }
.project-picker__list button:hover,
.project-picker__list button:focus,
.project-picker__list button.is-selected { background: var(--ui-surface-hover); outline: none; }
.project-picker__list button.is-selected { background: var(--ui-surface-selected); color: var(--ui-text-strong); font-weight: 500; }
.project-picker__list button.is-selected svg { color: #4e4a43; }
.project-picker__list svg { width: 15px; height: 15px; flex: 0 0 15px; }
.project-picker__list p { margin: 0; padding: 20px 8px; color: #817c73; font-size: 12px; text-align: center; }
.project-picker__list p.is-error { color: #9f4545; }
.project-picker footer { display: flex; justify-content: flex-end; gap: 7px; }
.project-picker footer button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer; }
.project-picker__cancel { background: transparent; color: var(--ui-text-muted); }
.project-picker__cancel:hover { background: var(--ui-surface-hover); }
.project-picker__open { background: var(--ui-primary); box-shadow: var(--ui-shadow-control); color: var(--ui-surface); }
.project-picker__open:hover:not(:disabled) { background: var(--ui-primary-hover); }
.project-picker footer button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(74 70 63 / 14%); }
.project-picker__open:disabled { cursor: default; opacity: 0.45; }

@media (prefers-reduced-motion: reduce) {
  .project-picker__path button,
  .project-picker__path input,
  .project-picker__list button { transition: none; }
}
</style>
