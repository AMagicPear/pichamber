<script lang="tsx">
import { computed, defineComponent, onMounted, provide, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import FileAddIcon from "lucide-static/icons/file-plus.svg";
import FolderAddIcon from "lucide-static/icons/folder-plus.svg";
import SearchBox from "@/components/ui/SearchBox.vue";
import type { DirEntry } from "@amagicpear/pichamber-shared";
import { listDirectory, searchFiles, toMessage } from "@/api/client";
import IconButton from "@/components/ui/IconButton.vue";
import { workspace } from "@/stores/workspace";
import { MorphIcon } from "morphicons/vue";
import { lucideIcon } from "../ui/morphIcons.ts";
import FileTreeNode, { FILE_TREE_REFRESH_KEY } from "./FileTreeNode";
import FileSearchResult from "./FileSearchResult.vue";
import "./file-tree.css";

const SEARCH_DEBOUNCE_MS = 120;

export default defineComponent({
  name: "FileTree",
  setup() {
    const { t } = useI18n();
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

    /** Same debounce + requestVersion pattern as composer file suggestions: a slow
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
            placeholder={t('files.searchPlaceholder')}
            label={t('files.searchLabel')}
          />
          <div class="file-tree__actions">
            <IconButton size="standard" label={t('files.newFile')} disabled>
              <FileAddIcon />
            </IconButton>
            <IconButton size="standard" label={t('files.newFolder')} disabled>
              <FolderAddIcon />
            </IconButton>
            <IconButton size="standard" label={t('common.refresh')} onClick={() => load()}>
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
            <p class="file-tree__state">{t('files.searching')}</p>
          ) : searchResults.value.length > 0 ? (
            <ul class="file-tree__list">
              {searchResults.value.map((entry) => (
                <FileSearchResult key={entry.path} entry={entry} />
              ))}
            </ul>
          ) : (
            <p class="file-tree__state">{t('files.noFilesMatch', { query: search.value })}</p>
          )
        ) : entries.value.length > 0 ? (
          <ul class="file-tree__list">
            {entries.value.map((entry) => (
              <FileTreeNode key={entry.path} entry={entry} />
            ))}
          </ul>
        ) : (
          <p class="file-tree__state">{t('files.noFiles')}</p>
        )}
      </div>
    );
  },
});
</script>
