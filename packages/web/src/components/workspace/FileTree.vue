<script lang="tsx">
import { computed, defineComponent, onMounted, ref, watch, type PropType } from "vue";
import CloseIcon from "@/assets/icons/Close.svg";
import FileAddIcon from "@/assets/icons/FileAdd.svg";
import FolderAddIcon from "@/assets/icons/FolderAdd.svg";
import RefreshIcon from "@/assets/icons/Refresh2.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import type { DirEntry } from "@pichamber/shared";
import { listDirectory, toMessage } from "@/api/client";
import IconButton from "@/components/IconButton.vue";
import { workspace } from "@/stores/workspace";
import { getEntryIcon } from "./fileIcon";

const FileTreeNode = defineComponent({
  name: "FileTreeNode",
  props: {
    entry: { type: Object as PropType<DirEntry>, required: true },
  },
  setup(props) {
    const expanded = ref(false);
    const children = ref<DirEntry[] | null>(null);
    const error = ref<string | null>(null);

    const loadChildren = async () => {
      if (!props.entry.isDirectory || children.value !== null) return;
      children.value = [];
      error.value = null;
      try {
        children.value = (await listDirectory(props.entry.path)).entries;
      } catch (err) {
        children.value = null;
        error.value = toMessage(err);
        console.error("[files] failed to list", props.entry.path, err);
      }
    };

    const toggle = () => {
      if (!props.entry.isDirectory) return;
      expanded.value = !expanded.value;
      if (expanded.value && children.value === null) loadChildren();
    };

    return () => {
      const EntryIcon = getEntryIcon(props.entry.name, props.entry.isDirectory, expanded.value);

      return (
        <li class="file-tree__item">
          <button
            type="button"
            class="file-tree__row"
            aria-expanded={props.entry.isDirectory ? expanded.value : undefined}
            onClick={toggle}
          >
            <span class={["file-tree__icon", { "is-folder": props.entry.isDirectory }]}> 
              <svg aria-hidden="true"><use href={EntryIcon} /></svg>
            </span>
            <span class="file-tree__name">{props.entry.name}</span>
          </button>
          {expanded.value && (
            <ul class="file-tree__list file-tree__children">
              {error.value ? (
                <li class="file-tree__state file-tree__state--error">{error.value}</li>
              ) : (
                children.value?.map((child) => <FileTreeNode key={child.path} entry={child} />)
              )}
            </ul>
          )}
        </li>
      );
    };
  },
});

export default defineComponent({
  name: "FileTree",
  setup() {
    const entries = ref<DirEntry[]>([]);
    const error = ref<string | null>(null);
    const search = ref("");
    let requestVersion = 0;

    const load = async () => {
      const currentRequest = ++requestVersion;
      error.value = null;
      entries.value = [];
      try {
        // The session cwd (when set) doubles as both the directory to list
        // and the workspace root the server uses for containment/display —
        // so a project on a different drive than the home directory still
        // loads on Windows.
        const workspaceRoot = workspace.cwd && workspace.cwd !== "~" ? workspace.cwd : undefined;
        const result = await listDirectory(workspaceRoot, workspaceRoot);
        if (currentRequest !== requestVersion) return;
        entries.value = result.entries;
      } catch (err) {
        if (currentRequest !== requestVersion) return;
        error.value = toMessage(err);
        console.error("[files] failed to list workspace root", err);
      }
    };

    const visibleEntries = computed(() => {
      const query = search.value.trim().toLowerCase();
      if (!query) return entries.value;
      return entries.value.filter((entry) => entry.relativePath.toLowerCase().includes(query));
    });

    onMounted(load);
    watch(() => workspace.cwd, load);

    return () => (
      <div class="file-tree file-tree--root">
        <div class="file-tree__toolbar">
          <div class="file-tree__search">
            <span class="file-tree__search-icon">
              <SearchIcon />
            </span>
            <input
              value={search.value}
              type="search"
              placeholder="Search files..."
              aria-label="Search files"
              onInput={(event: Event) => {
                search.value = (event.target as HTMLInputElement).value;
              }}
            />
            {search.value && (
              <button
                type="button"
                class="file-tree__search-clear"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  search.value = "";
                }}
              >
                <CloseIcon />
              </button>
            )}
          </div>
          <div class="file-tree__actions">
            <IconButton size="standard" label="New file">
              <FileAddIcon />
            </IconButton>
            <IconButton size="standard" label="New folder">
              <FolderAddIcon />
            </IconButton>
            <IconButton size="standard" label="Reload" onClick={load}>
              <RefreshIcon />
            </IconButton>
          </div>
        </div>

        {error.value ? (
          <p class="file-tree__state file-tree__state--error">{error.value}</p>
        ) : visibleEntries.value.length > 0 ? (
          <ul class="file-tree__list">
            {visibleEntries.value.map((entry) => (
              <FileTreeNode key={entry.path} entry={entry} />
            ))}
          </ul>
        ) : (
          <p class="file-tree__state">
            {search.value ? `No files match "${search.value}"` : "No files"}
          </p>
        )}
      </div>
    );
  },
});
</script>

<style>
.file-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.file-tree--root {
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
  height: 32px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid #e7e4dc;
  border-radius: 8px;
  background: #fafaf7;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.file-tree__search:focus-within {
  border-color: #bcbcbc;
  background: #fff;
}
.file-tree__search-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: #666;
}
.file-tree__search-icon svg {
  display: block;
  width: 100%;
  height: 100%;
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
  font-size: 13px;
}
.file-tree__search input::-webkit-search-cancel-button {
  display: none;
  appearance: none;
}
.file-tree__search input::placeholder {
  color: #999;
}
.file-tree__search-clear {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #777;
}
.file-tree__search-clear:hover {
  background: #ededed;
  color: #333;
}
.file-tree__search-clear:focus-visible {
  outline: 2px solid #3978d4;
  outline-offset: 1px;
}
.file-tree__search-clear svg {
  width: 12px;
  height: 12px;
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
  padding: 8px 8px 8px 18px;
  list-style: none;
  overflow: auto;
}
.file-tree__children {
  position: relative;
  margin: 0 0 0 12px;
  padding: 0 0 0 12px;
  border-left: 1px solid #e5e5e5;
  overflow: visible;
}
.file-tree__children > .file-tree__item::before {
  position: absolute;
  top: 14px;
  left: -12px;
  width: 12px;
  height: 1px;
  background: #e5e5e5;
  content: "";
}
.file-tree__children > .file-tree__item:last-child::after {
  position: absolute;
  top: 15px;
  bottom: 0;
  left: -13px;
  width: 2px;
  background: #fff;
  content: "";
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
  padding: 3px 10px 3px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.file-tree__row:hover {
  background: #f5f4f0;
}
.file-tree__row:focus-visible {
  outline: 2px solid #3978d4;
  outline-offset: -2px;
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
.file-tree__icon img {
  display: block;
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
.file-tree__state {
  margin: 0;
  padding: 14px;
  color: #888;
  font-size: 13px;
}
.file-tree__state--error {
  color: #a33;
}
</style>
