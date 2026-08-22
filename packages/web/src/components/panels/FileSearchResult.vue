<script lang="tsx">
import { defineComponent, type PropType } from "vue";
import type { DirEntry } from "@amagicpear/pichamber-shared";
import { getEntryIcon } from "../ui/fileIcon";

/** Flat row for a single global-search match. Unlike `FileTreeNode`, the
 *  entry isn't part of the live tree — just a hit — so no expand state, no
 *  nested children. Name and path share a single text run so the parent
 *  container's `text-overflow: ellipsis` clips the path first; the file
 *  name (at the start of the line) is preserved even at narrow widths. */
export default defineComponent({
  name: "FileSearchResult",
  props: {
    entry: { type: Object as PropType<DirEntry>, required: true },
  },
  setup(props) {
    return () => {
      const Icon = getEntryIcon(props.entry.name, props.entry.isDirectory, false);
      return (
        <li class="file-tree__item">
          <div
            class="file-tree__row file-tree__row--search ui-list-row"
            title={`${props.entry.name} · ${props.entry.relativePath}`}
          >
            <span class={["file-tree__icon", { "is-folder": props.entry.isDirectory }]}>
              <svg aria-hidden="true"><use href={Icon} /></svg>
            </span>
            <span class="file-tree__name">
              {props.entry.name}
              <span class="file-tree__path">{" · "}{props.entry.relativePath}</span>
            </span>
          </div>
        </li>
      );
    };
  },
});
</script>