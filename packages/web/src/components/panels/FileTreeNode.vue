<script lang="tsx">
import { defineComponent, inject, ref, watch, type InjectionKey, type PropType, type Ref } from "vue";
import type { DirEntry } from "@amagicpear/pichamber-shared";
import { listDirectory, toMessage } from "@/api/client";
import { workspace } from "@/stores/workspace";
import { getEntryIcon } from "../ui/fileIcon";

/** Increments every time the root `FileTree` reloads, so expanded
 *  descendants can refetch their own listing. Self-referencing nodes
 *  share the same ref via `provide`/`inject` in the parent. */
export const FILE_TREE_REFRESH_KEY: InjectionKey<Ref<number>> = Symbol("fileTree:refresh");

export default defineComponent({
  name: "FileTreeNode",
  props: {
    entry: { type: Object as PropType<DirEntry>, required: true },
  },
  setup(props) {
    const expanded = ref(false);
    const children = ref<DirEntry[] | null>(null);
    const error = ref<string | null>(null);
    const isLoading = ref(false);
    /** Per-node request version, so a slow prior fetch can't overwrite
     *  the result of a newer one (e.g. expand → refresh → collapse → expand). */
    let nodeRequestVersion = 0;

    const refreshTrigger = inject(FILE_TREE_REFRESH_KEY, null);

    const loadChildren = async (force = false) => {
      if (!props.entry.isDirectory) return;
      if (!force && children.value !== null) return;
      const currentVersion = ++nodeRequestVersion;
      isLoading.value = true;
      error.value = null;
      try {
        const result = await listDirectory(workspace.sessionId, props.entry.path);
        if (currentVersion !== nodeRequestVersion) return;
        children.value = result.entries;
      } catch (err) {
        if (currentVersion !== nodeRequestVersion) return;
        children.value = null;
        error.value = toMessage(err);
        console.error("[files] failed to list", props.entry.path, err);
      } finally {
        if (currentVersion === nodeRequestVersion) isLoading.value = false;
      }
    };

    const toggle = () => {
      if (!props.entry.isDirectory) return;
      expanded.value = !expanded.value;
      if (expanded.value && children.value === null) loadChildren();
    };

    // Root refresh: only expanded folders spend a request, matching
    // what the user can actually see. Collapsed folders stay cached
    // and refresh on next expand.
    if (refreshTrigger) {
      watch(
        () => refreshTrigger.value,
        () => {
          if (expanded.value) loadChildren(true);
        },
      );
    }

    return () => {
      const EntryIcon = getEntryIcon(props.entry.name, props.entry.isDirectory, expanded.value);
      return (
        <li class="file-tree__item">
          <button
            type="button"
            class="file-tree__row ui-list-row"
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
              ) : isLoading.value ? (
                <li class="file-tree__state">Loading…</li>
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
</script>