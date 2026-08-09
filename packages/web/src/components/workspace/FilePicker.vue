<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DirEntry } from "@pichamber/shared";
import { listDirectory, toMessage } from "@/api/client";
import FolderOpenIcon from "@/assets/icons/FolderOpen.svg";
import IconButton from "@/components/IconButton.vue";
import MenuPanel from "@/components/MenuPanel.vue";
import { getEntryIcon } from "@/components/workspace/fileIcon";

const props = defineProps<{
  open: boolean;
  /** Fixed-position style computed by usePopover. */
  style: Record<string, string>;
}>();

const emit = defineEmits<{
  /** Emits the workspace-relative path of the picked file. */
  select: [relativePath: string];
}>();

/** Current directory as workspace-relative segments; "" = workspace root. */
const cwd = ref("");
const entries = ref<DirEntry[]>([]);
const error = ref<string | null>(null);
let requestVersion = 0;

const load = async () => {
  const current = ++requestVersion;
  error.value = null;
  entries.value = [];
  try {
    const result = await listDirectory(cwd.value || undefined);
    if (current !== requestVersion) return;
    entries.value = result.entries;
  } catch (err) {
    if (current !== requestVersion) return;
    error.value = toMessage(err);
    console.error("[picker] failed to list", cwd.value, err);
  }
};

// Reset to the workspace root each time the picker opens.
watch(
  () => props.open,
  (open) => {
    if (open) {
      cwd.value = "";
      load();
    }
  },
);

const displayPath = computed(() => (cwd.value ? `~/${cwd.value}` : "~"));

const enter = (entry: DirEntry) => {
  cwd.value = entry.relativePath;
  load();
};

const goUp = () => {
  if (!cwd.value) return;
  cwd.value = cwd.value.split("/").slice(0, -1).join("/");
  load();
};

const pick = (entry: DirEntry) => {
  emit("select", entry.relativePath);
};
</script>

<template>
  <MenuPanel
    :open="open"
    :style="style"
    :width="340"
    :height="380"
    role="dialog"
    aria-label="Attach files"
  >
    <div class="file-picker">
      <div class="file-picker__path">
        <IconButton size="compact" label="Up one level" :disabled="!cwd" @click="goUp">
          <FolderOpenIcon />
        </IconButton>
        <span class="file-picker__cwd">{{ displayPath }}</span>
      </div>
      <ul class="file-picker__list">
        <li v-for="entry in entries" :key="entry.path">
          <button
            type="button"
            class="menu-item menu-item--split file-picker__row"
            :aria-label="entry.isDirectory ? `Open ${entry.name}` : `Attach ${entry.name}`"
            @click="entry.isDirectory ? enter(entry) : pick(entry)"
          >
            <span class="file-picker__label">
              <img class="file-picker__icon" :src="getEntryIcon(entry.name, entry.isDirectory, false)" alt="" />
              <span class="file-picker__name">{{ entry.name }}</span>
            </span>
            <span v-if="!entry.isDirectory" class="file-picker__ref">@{{ entry.relativePath }}</span>
          </button>
        </li>
        <li v-if="error" class="file-picker__state file-picker__state--error">{{ error }}</li>
        <li v-else-if="entries.length === 0" class="file-picker__state">Empty folder</li>
      </ul>
    </div>
  </MenuPanel>
</template>

<style scoped>
.file-picker {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.file-picker__path {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  padding: 6px 6px 6px 4px;
  border-bottom: 1px solid #ededed;
}
.file-picker__cwd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #666;
  font-size: 12px;
}
.file-picker__list {
  flex: 1 1 0;
  min-height: 0;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  overflow-y: auto;
}
.file-picker__label {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.file-picker__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}
.file-picker__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-picker__ref {
  flex: 0 0 auto;
  margin-left: 8px;
  color: #999;
  font-size: 11px;
}
.file-picker__state {
  padding: 16px;
  color: #888;
  font-size: 12px;
  text-align: center;
}
.file-picker__state--error {
  color: #a33;
}
</style>
