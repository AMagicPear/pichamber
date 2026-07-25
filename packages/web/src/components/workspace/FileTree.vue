<script setup lang="ts">
import { computed, ref, watch } from "vue";
import FileAddIcon from "@/assets/icons/FileAdd.svg";
import FileList2Icon from "@/assets/icons/FileList2.svg";
import FolderIcon from "@/assets/icons/Folder.svg";
import FolderAddIcon from "@/assets/icons/FolderAdd.svg";
import RefreshIcon from "@/assets/icons/Refresh2.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import type { DirEntry, ListResult } from "@/api/client";
import { listDirectory } from "@/api/client";
import IconButton from "@/components/IconButton.vue";

const props = withDefaults(
  defineProps<{
    nodes: DirEntry[];
    depth?: number;
  }>(),
  { depth: 0 },
);
const emit = defineEmits<{ reload: [] }>();

const children = ref<Map<string, DirEntry[]>>(new Map());
const expanded = ref<Set<string>>(new Set());
const loading = ref<Set<string>>(new Set());
const search = ref("");
const hasQuery = computed(() => search.value.trim().length > 0);

async function loadChildren(entry: DirEntry): Promise<void> {
  if (children.value.has(entry.path) || loading.value.has(entry.path)) return;
  loading.value.add(entry.path);
  loading.value = new Set(loading.value);
  try {
    const result: ListResult = await listDirectory(entry.path);
    const next = new Map(children.value);
    next.set(entry.path, result.entries);
    children.value = next;
  } catch (err) {
    const next = new Map(children.value);
    next.set(entry.path, []);
    children.value = next;
    console.error("[files] failed to list", entry.path, err);
  } finally {
    loading.value.delete(entry.path);
    loading.value = new Set(loading.value);
  }
}

function toggle(entry: DirEntry): void {
  if (!entry.isDirectory) return;
  if (expanded.value.has(entry.path)) {
    const next = new Set(expanded.value);
    next.delete(entry.path);
    expanded.value = next;
    return;
  }
  expanded.value = new Set(expanded.value).add(entry.path);
  void loadChildren(entry);
}

const filteredNodes = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return props.nodes;
  return props.nodes.filter((node) => node.relativePath.toLowerCase().includes(query));
});

function isLoading(path: string): boolean {
  return loading.value.has(path);
}

function hasLoaded(path: string): boolean {
  return children.value.has(path);
}

function getChildren(path: string): DirEntry[] {
  return children.value.get(path) ?? [];
}

watch(
  () => props.nodes,
  () => {
    children.value = new Map();
    expanded.value = new Set();
  },
);
</script>

<template>
  <div class="file-tree" :class="{ 'is-root': depth === 0 }">
    <div v-if="depth === 0" class="file-tree__toolbar">
      <div class="file-tree__search">
        <SearchIcon class="file-tree__search-icon" />
        <input v-model="search" type="search" placeholder="Search files..." aria-label="Search files" />
      </div>
      <div class="file-tree__actions">
        <IconButton size="standard" label="New file"><FileAddIcon /></IconButton>
        <IconButton size="standard" label="New folder"><FolderAddIcon /></IconButton>
        <IconButton size="standard" label="Reload" @click="emit('reload')"><RefreshIcon /></IconButton>
      </div>
    </div>

    <ul v-if="filteredNodes.length > 0" class="file-tree__list">
      <li v-for="(entry, index) in filteredNodes" :key="entry.path" class="file-tree__item">
        <span v-if="depth > 0" class="file-tree__tick" aria-hidden="true" />
        <span v-if="depth > 0 && index === filteredNodes.length - 1" class="file-tree__last-cover" aria-hidden="true" />
        <button type="button" class="file-tree__row" @click="toggle(entry)">
          <span class="file-tree__icon" :class="{ 'is-folder': entry.isDirectory }">
            <FolderIcon v-if="entry.isDirectory" />
            <FileList2Icon v-else />
          </span>
          <span class="file-tree__name">{{ entry.name }}</span>
          <span v-if="isLoading(entry.path)" class="file-tree__spinner" aria-hidden="true" />
        </button>
        <FileTree
          v-if="entry.isDirectory && expanded.has(entry.path) && hasLoaded(entry.path)"
          class="file-tree__children"
          :nodes="getChildren(entry.path)"
          :depth="depth + 1"
          @reload="emit('reload')"
        />
      </li>
    </ul>
    <p v-else-if="hasQuery" class="file-tree__empty">No files match "{{ search }}"</p>
    <p v-else class="file-tree__empty">No files</p>
  </div>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.file-tree__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid #ededed;
}
.file-tree__search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  height: 30px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid #dedede;
  border-radius: 8px;
  background: #fff;
}
.file-tree__search:focus-within {
  border-color: #bcbcbc;
}
.file-tree__search-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: #666;
}
.file-tree__search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
}
.file-tree__search input::placeholder {
  color: #6d6d6d;
}
.file-tree__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-tree__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 8px 8px 8px 13px;
  list-style: none;
  overflow: auto;
}
.file-tree__item {
  position: relative;
}
.file-tree__row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 28px;
  padding: 3px 10px 3px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.file-tree__row:hover {
  background: rgb(0 0 0 / 4%);
}
.file-tree__icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: #d9936c;
}
.file-tree__icon:not(.is-folder) {
  color: #399cf0;
}
.file-tree__icon svg {
  width: 18px;
  height: 18px;
}
.file-tree__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-tree__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid #aaa;
  border-top-color: transparent;
  border-radius: 50%;
  animation: file-tree-spin 700ms linear infinite;
}
.file-tree__children {
  position: relative;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid #e5e5e5;
}
.file-tree__tick {
  position: absolute;
  top: 14px;
  left: -12px;
  width: 12px;
  height: 1px;
  background: #e5e5e5;
}
.file-tree__last-cover {
  position: absolute;
  top: 14px;
  bottom: 0;
  left: -13px;
  width: 2px;
  background: #fff;
}
.file-tree__empty {
  margin: 0;
  padding: 20px 16px;
  color: #888;
  font-size: 12px;
  text-align: center;
}
@keyframes file-tree-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
