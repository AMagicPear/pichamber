<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { DirEntry } from "@pichamber/shared";
import { listDirectory, searchFiles, toMessage } from "@/api/client";
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";
import IconButton from "@/components/IconButton.vue";
import { getEntryIcon } from "@/components/workspace/fileIcon";
import { workspace } from "@/stores/workspace";

const props = defineProps<{
  open: boolean;
  /** 打开时是否聚焦搜索框（菜单入口用；@ 入口保持 textarea 焦点）。 */
  focusSearch?: boolean;
}>();

const emit = defineEmits<{
  /** Emits the workspace-relative path of the picked file. */
  select: [relativePath: string];
}>();

/** 搜索词受外部（textarea 的 @ 前缀）联动，也可在面板里直接编辑。 */
const query = defineModel<string>("query", { default: "" });

/** Workspace root the picker browses from (the session cwd, like the
 *  files panel); null falls back to the server's default workspace. */
const root = computed(() => (workspace.cwd && workspace.cwd !== "~" ? workspace.cwd : null));

/** Current directory as an absolute path; null = the workspace root. */
const cwd = ref<string | null>(null);
const entries = ref<DirEntry[]>([]);
const error = ref<string | null>(null);
const searching = ref(false);
let requestVersion = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const searchBox = ref<HTMLInputElement | null>(null);

const searchingNow = computed(() => query.value.trim().length > 0);

const loadDir = async (dir: string | null) => {
  const current = ++requestVersion;
  error.value = null;
  entries.value = [];
  try {
    const result = await listDirectory(dir ?? root.value ?? undefined);
    if (current !== requestVersion) return;
    entries.value = result.entries;
  } catch (err) {
    if (current !== requestVersion) return;
    error.value = toMessage(err);
    console.error("[file-ref-picker] failed to list", dir, err);
  }
};

const runSearch = async (q: string) => {
  const current = ++requestVersion;
  searching.value = true;
  error.value = null;
  try {
    const result = await searchFiles(q);
    if (current !== requestVersion) return;
    entries.value = result.entries;
  } catch (err) {
    if (current !== requestVersion) return;
    error.value = toMessage(err);
  } finally {
    if (current === requestVersion) searching.value = false;
  }
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      cwd.value = null;
      // 搜索词由外部 @ 前缀同步；打开时若有词直接搜，否则列根目录。
      // @ 入口焦点留在 textarea（继续打字联动过滤）；菜单入口聚焦搜索框。
      if (query.value.trim()) void runSearch(query.value);
      else void loadDir(null);
      if (props.focusSearch) nextTick(() => searchBox.value?.focus());
    }
  },
);

watch(query, (q) => {
  if (!props.open) return;
  clearTimeout(searchTimer);
  if (q.trim()) searchTimer = setTimeout(() => void runSearch(q), 150);
  else void loadDir(cwd.value);
});

const atRoot = computed(
  () => cwd.value === null || (root.value !== null && cwd.value === root.value),
);

/** Display path relative to the workspace root; `~` for the root itself. */
const displayPath = computed(() => {
  if (searchingNow.value) return `Search: ${query.value.trim()}`;
  if (cwd.value === null) return "~";
  if (root.value && cwd.value.startsWith(`${root.value}/`)) {
    return `~/${cwd.value.slice(root.value.length + 1)}`;
  }
  return cwd.value;
});

/** Workspace-relative form of an entry, so `@` resolves against the cwd. */
const relFor = (entry: DirEntry): string =>
  root.value && entry.path.startsWith(`${root.value}/`)
    ? entry.path.slice(root.value.length + 1)
    : entry.relativePath;

const enter = (entry: DirEntry) => {
  // 从搜索进入目录：切换回浏览模式，清空搜索词。
  query.value = "";
  cwd.value = entry.path;
  void loadDir(cwd.value);
};

const goUp = () => {
  if (atRoot.value) return;
  cwd.value = cwd.value!.split("/").slice(0, -1).join("/") || "/";
  void loadDir(cwd.value);
};

const pick = (entry: DirEntry) => {
  emit("select", relFor(entry));
};

/** Enter in the search box picks the first result (file, or enters a dir). */
const onSearchKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Enter") return;
  const first = entries.value[0];
  if (!first) return;
  event.preventDefault();
  if (first.isDirectory) enter(first);
  else pick(first);
};
</script>

<template>
  <div v-if="open" class="file-ref-picker" role="dialog" aria-label="Attach files">
    <div class="file-ref-picker__search">
      <input
        ref="searchBox"
        v-model="query"
        class="file-ref-picker__input"
        type="text"
        placeholder="Search files…"
        aria-label="Search files"
        @keydown="onSearchKeydown"
      />
    </div>
    <div class="file-ref-picker__path">
      <IconButton
        size="compact"
        class="file-ref-picker__up"
        label="Up one level"
        :disabled="atRoot"
        @click="goUp"
      >
        <ArrowDownSIcon />
      </IconButton>
      <span class="file-ref-picker__cwd" :title="displayPath">{{ displayPath }}</span>
    </div>
    <ul class="file-ref-picker__list">
      <li v-for="entry in entries" :key="entry.path">
        <button
          type="button"
          class="file-ref-picker__row"
          :aria-label="entry.isDirectory ? `Open ${entry.name}` : `Attach ${entry.name}`"
          @click="entry.isDirectory ? enter(entry) : pick(entry)"
        >
          <span class="file-ref-picker__label">
            <svg class="file-ref-picker__icon" aria-hidden="true"><use :href="getEntryIcon(entry.name, entry.isDirectory, false)" /></svg>
            <span class="file-ref-picker__name">{{ entry.name }}</span>
          </span>
          <span v-if="!entry.isDirectory" class="file-ref-picker__ref">@{{ relFor(entry) }}</span>
        </button>
      </li>
      <li v-if="searching" class="file-ref-picker__state">Searching…</li>
      <li v-else-if="error" class="file-ref-picker__state file-ref-picker__state--error">{{ error }}</li>
      <li v-else-if="entries.length === 0" class="file-ref-picker__state">
        {{ searchingNow ? "No matches" : "Empty folder" }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* 浮在 composer 上方的面板：bottom 锚定（由父级 .composer 定位）。 */
.file-ref-picker {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100vw - 24px));
  max-height: min(340px, 50vh);
  border: 1px solid #dedbd2;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
  overflow: hidden;
  z-index: 40;
}
.file-ref-picker__search {
  flex: 0 0 auto;
  padding: 8px;
  border-bottom: 1px solid #ededed;
}
.file-ref-picker__input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #e7e4dc;
  border-radius: 8px;
  outline: 0;
  color: inherit;
  font: inherit;
  font-size: 13px;
  background: #fafaf7;
  transition: border-color 120ms ease;
}
.file-ref-picker__input:focus {
  border-color: #bcbcbc;
  background: #fff;
}
.file-ref-picker__input::placeholder {
  color: #999;
}
.file-ref-picker__path {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid #ededed;
}
.file-ref-picker__up svg {
  width: 14px;
  height: 14px;
  /* Up = the down chevron flipped, like the old picker did. */
  transform: rotate(180deg);
}
.file-ref-picker__cwd {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #666;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.file-ref-picker__list {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow-y: auto;
}
.file-ref-picker__row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.file-ref-picker__row:hover {
  background: #f5f4f0;
}
.file-ref-picker__label {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 7px;
}
.file-ref-picker__icon {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}
.file-ref-picker__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-ref-picker__ref {
  flex: 0 0 auto;
  margin-left: 8px;
  color: #999;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.file-ref-picker__state {
  padding: 14px;
  color: #888;
  font-size: 13px;
  text-align: center;
}
.file-ref-picker__state--error {
  color: #b04848;
}
</style>
