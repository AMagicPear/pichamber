<script lang="tsx">
import { computed, defineComponent, onMounted, provide, ref, watch } from "vue";
import FileAddIcon from "lucide-static/icons/file-plus.svg";
import FolderAddIcon from "lucide-static/icons/folder-plus.svg";
import SearchBox from "@/components/ui/SearchBox.vue";
import type { DirEntry } from "@amagicpear/pichamber-shared";
import { listDirectory, searchFiles, toMessage } from "@/api/client";
import IconButton from "@/components/ui/IconButton.vue";
import { workspace } from "@/stores/workspace";
import { MorphIcon } from "morphicons/vue";
import { lucideIcon } from "../ui/morphIcons.ts";
import FileTreeNode, { FILE_TREE_REFRESH_KEY } from "./FileTreeNode.vue";
import FileSearchResult from "./FileSearchResult.vue";

const SEARCH_DEBOUNCE_MS = 120;

export default defineComponent({
  name: "FileTree",
  setup() {
    const entries = ref<DirEntry[]>([]);
    const error = ref<string | null>(null);
    const search = ref("");
    const refreshIcon = ref<'refresh-cw' | 'refresh-ccw'>('refresh-cw');
    const refreshTrigger = ref(0);
    provide(FILE_TREE_REFRESH_KEY, refreshTrigger);

    const searchResults = ref<DirEntry[]>([]);
    const searchLoading = ref(false);
    const searchError = ref<string | null>(null);
    /** Increments on every `runSearch` call (incl. resets) so any in-flight
     *  fetch from a stale query — or a previous workspace — is discarded
     *  instead of overwriting the current results. */
    let searchRequestVersion = 0;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    let requestVersion = 0;

    /** `reset` clears the visible list before fetching — only needed when
     *  the previous listing belongs to a different cwd (initial mount /
     *  workspace change). The refresh button calls without `reset` so
     *  Vue's `:key`-based diffing reuses existing `FileTreeNode` instances
     *  and preserves their expanded state. */
    const load = async (reset = false) => {
      refreshIcon.value = 'refresh-ccw';
      const currentRequest = ++requestVersion;
      error.value = null;
      if (reset) entries.value = [];
      try {
        const result = await listDirectory(workspace.sessionId);
        if (currentRequest !== requestVersion) return;
        entries.value = result.entries;
        refreshTrigger.value++;
      } catch (err) {
        if (currentRequest !== requestVersion) return;
        entries.value = [];
        error.value = toMessage(err);
        console.error("[files] failed to list workspace root", err);
      } finally {
        setTimeout(() => {
          if (currentRequest === requestVersion) refreshIcon.value = 'refresh-cw';
        }, 240);
      }
    };

    /** Same debounce + requestVersion pattern as `ComposerShelf`: a slow
     *  earlier fetch must not overwrite a newer query's results. */
    const runSearch = async (query: string) => {
      const current = ++searchRequestVersion;
      const trimmed = query.trim();
      if (!trimmed) {
        searchResults.value = [];
        searchError.value = null;
        searchLoading.value = false;
        return;
      }
      searchLoading.value = true;
      searchError.value = null;
      try {
        const result = await searchFiles(workspace.sessionId, trimmed);
        if (current !== searchRequestVersion) return;
        searchResults.value = result.entries;
      } catch (err) {
        if (current !== searchRequestVersion) return;
        searchError.value = toMessage(err);
        searchResults.value = [];
      } finally {
        if (current === searchRequestVersion) searchLoading.value = false;
      }
    };

    watch(search, (query) => {
      clearTimeout(searchTimer);
      // Empty query: clear immediately so the tree reappears without
      // waiting out the debounce; non-empty: debounce rapid typing.
      if (!query.trim()) {
        void runSearch(query);
      } else {
        searchTimer = setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS);
      }
    });

    const isSearching = computed(() => search.value.trim().length > 0);

    onMounted(() => load(true));
    watch(() => workspace.cwd, () => {
      // Previous search results belong to the old cwd; reset so the tree
      // reappears cleanly under the new workspace.
      search.value = "";
      load(true);
    });

    return () => (
      <div class="file-tree file-tree--root">
        <div class="file-tree__toolbar">
          <SearchBox
            modelValue={search.value}
            onUpdate:modelValue={(value: string) => {
              search.value = value;
            }}
            placeholder="Search files..."
            label="Search files"
          />
          <div class="file-tree__actions">
            <IconButton size="standard" label="New file" disabled>
              <FileAddIcon />
            </IconButton>
            <IconButton size="standard" label="New folder" disabled>
              <FolderAddIcon />
            </IconButton>
            <IconButton size="standard" label="Reload" onClick={() => load()}>
              <MorphIcon icon={lucideIcon(refreshIcon.value)} spring="snappy" />
            </IconButton>
          </div>
        </div>

        {error.value ? (
          <p class="file-tree__state file-tree__state--error">{error.value}</p>
        ) : isSearching.value ? (
          searchError.value ? (
            <p class="file-tree__state file-tree__state--error">{searchError.value}</p>
          ) : searchLoading.value ? (
            <p class="file-tree__state">Searching…</p>
          ) : searchResults.value.length > 0 ? (
            <ul class="file-tree__list">
              {searchResults.value.map((entry) => (
                <FileSearchResult key={entry.path} entry={entry} />
              ))}
            </ul>
          ) : (
            <p class="file-tree__state">No files match "{search.value}"</p>
          )
        ) : entries.value.length > 0 ? (
          <ul class="file-tree__list">
            {entries.value.map((entry) => (
              <FileTreeNode key={entry.path} entry={entry} />
            ))}
          </ul>
        ) : (
          <p class="file-tree__state">No files</p>
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.file-tree__toolbar > :deep(.search-box) {
  flex: 1;
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
  border-left: 1px solid var(--ui-border-subtle);
  overflow: visible;
}

.file-tree__children>.file-tree__item::before {
  position: absolute;
  top: 14px;
  left: -12px;
  width: 12px;
  height: 1px;
  background: var(--ui-border-subtle);
  content: "";
}

.file-tree__children>.file-tree__item:last-child::after {
  position: absolute;
  top: 15px;
  bottom: 0;
  left: -13px;
  width: 2px;
  background: var(--ui-surface);
  content: "";
}

.file-tree__item {
  position: relative;
}

.file-tree__row {
  width: 100%;
  gap: 7px;
  padding: 3px 10px 3px 6px;
  border-radius: var(--ui-radius-md);
  font-size: 13px;
}

.file-tree__row:focus-visible {
  outline: 2px solid var(--ui-focus);
  outline-offset: -2px;
}

.file-tree__row--search {
  cursor: default;
}

.file-tree__icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--ui-icon-folder);
}

.file-tree__icon:not(.is-folder) {
  color: var(--ui-icon-file);
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

.file-tree__path {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.file-tree__state {
  margin: 0;
  padding: 14px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.file-tree__state--error {
  color: var(--ui-error-strong);
}
</style>
