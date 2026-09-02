<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import CloseIcon from "lucide-static/icons/x.svg";
import FolderIcon from "lucide-static/icons/folder.svg";
import InfoIcon from "lucide-static/icons/info.svg";
import Modal from "@/components/ui/Modal.vue";
import { browseProjectDirectories, toMessage } from "@/api/client";

const { t } = useI18n();

const props = defineProps<{ show: boolean; initialPath?: string }>();
const emit = defineEmits<{ close: []; select: [path: string] }>();

const path = ref("");
const entries = ref<Array<{ name: string; path: string }>>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const requestedPath = ref<string | null>(null);
let requestVersion = 0;

const browse = async (target?: string) => {
  const current = ++requestVersion;
  loading.value = true;
  error.value = null;
  try {
    const result = await browseProjectDirectories(target);
    if (current !== requestVersion) return;
    path.value = result.path;
    entries.value = result.entries;
    requestedPath.value = result.requestedPath;
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
    void browse(props.initialPath);
  },
);

const choose = () => {
  const target = path.value.trim();
  if (target) emit("select", target);
};

const dismissAncestorNotice = () => {
  requestedPath.value = null;
};

/** Split the current path on the platform separator so the breadcrumb
 *  renders platform-correct segments (Windows: \foo\bar, Unix: /foo/bar). */
const breadcrumbSegments = computed(() => {
  if (!path.value) return [] as Array<{ name: string; path: string }>;
  const trimmed = path.value.replace(/[\\/]+$/, "");
  const segments: Array<{ name: string; path: string }> = [];
  const sep = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  let running = sep === "/" ? "/" : "";
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    if (sep === "\\" && /^[A-Za-z]:$/.test(part)) {
      running = `${part}\\`;
      segments.push({ name: part, path: running });
    } else {
      running = `${running}${part}${sep}`;
      segments.push({ name: part, path: running });
    }
  }
  return segments;
});

/** Resolve a user-facing error message via i18n. We only translate the two
 *  shapes the server actually emits (`ENOENT` / generic); everything else
 *  falls through to the raw message so unexpected failures stay debuggable. */
const localizedError = computed(() => {
  const message = error.value;
  if (!message) return null;
  if (/not found/i.test(message)) return t("projectPicker.errorNotFound");
  return message;
});
</script>

<template>
  <Modal size="sm" placement="top" :show="show" @close="emit('close')">
    <template #body>
      <div class="project-picker">
        <div v-if="requestedPath" class="project-picker__notice">
          <InfoIcon />
          <span>{{ t('projectPicker.ancestorNotice', { requested: requestedPath, current: path }) }}</span>
          <button type="button" class="project-picker__notice-close" :aria-label="t('common.close')" @click="dismissAncestorNotice">
            <CloseIcon />
          </button>
        </div>
        <nav v-if="breadcrumbSegments.length" class="project-picker__breadcrumb" :aria-label="t('projectPicker.pathLabel')">
          <template v-for="(segment, index) in breadcrumbSegments" :key="segment.path">
            <span v-if="index > 0" class="project-picker__breadcrumb-sep" aria-hidden="true">/</span>
            <button type="button"
              :class="['project-picker__breadcrumb-segment', { 'is-current': index === breadcrumbSegments.length - 1 }]"
              :title="segment.path"
              :aria-current="index === breadcrumbSegments.length - 1 ? 'location' : undefined"
              @click="browse(segment.path)">{{ segment.name }}</button>
          </template>
        </nav>
        <div class="project-picker__list">
          <button v-for="entry in entries" :key="`${entry.name}:${entry.path}`" type="button" class="project-picker__entry"
            :title="t('projectPicker.openFolder')" @click="browse(entry.path)">
            <FolderIcon />
            <span>{{ entry.name }}</span>
          </button>
          <p v-if="loading">{{ t('projectPicker.loadingDirectories') }}</p>
          <p v-else-if="localizedError" class="is-error">{{ localizedError }}</p>
          <p v-else-if="entries.length === 0">{{ t('projectPicker.noSubdirectories') }}</p>
        </div>
        <footer>
          <span class="project-picker__hint">{{ t('projectPicker.hint') }}</span>
          <button type="button" class="project-picker__cancel" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="project-picker__open" :disabled="loading || !path.trim()" @click="choose">{{ t('projectPicker.useThisFolder') }}</button>
        </footer>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.project-picker { display: grid; width: 100%; gap: 8px; padding: 8px; }

.project-picker__notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 6px;
  background: var(--ui-warning-soft, #fdf3d8);
  color: var(--ui-warning-text, #6f4f00);
  font-size: 12px;
  line-height: 16px;
}

.project-picker__notice :deep(svg) {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
}

.project-picker__notice-close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color var(--ui-duration-fast) var(--ui-ease-standard);
}

.project-picker__notice-close :deep(svg) {
  width: 12px;
  height: 12px;
}

.project-picker__notice-close:hover {
  background: rgb(0 0 0 / 8%);
}

.project-picker__breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--ui-text-muted);
}

.project-picker__breadcrumb-sep {
  flex: 0 0 auto;
  user-select: none;
  pointer-events: none;
  color: var(--ui-text-muted);
  opacity: 0.5;
}

.project-picker__breadcrumb-segment {
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--ui-duration-fast) var(--ui-ease-standard), color var(--ui-duration-fast) var(--ui-ease-standard);
  max-width: 16ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-picker__breadcrumb-segment:hover:not(.is-current) {
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}

.project-picker__breadcrumb-segment.is-current {
  cursor: default;
  color: var(--ui-text-strong);
  font-weight: 500;
}

.project-picker__list {
  min-height: 180px;
  max-height: 360px;
  overflow: auto;
  padding: 2px 0;
  border: 0;
  background: transparent;
}

.project-picker__entry {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: color var(--ui-duration-fast) var(--ui-ease-standard), background-color var(--ui-duration-fast) var(--ui-ease-standard);
}

.project-picker__entry:hover,
.project-picker__entry:focus {
  color: var(--ui-text-strong);
  background: var(--ui-surface-hover);
  outline: none;
}

.project-picker__entry :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
}

.project-picker__list p {
  margin: 0;
  padding: 20px 8px;
  color: #817c73;
  font-size: 12px;
  text-align: center;
}

.project-picker__list p.is-error {
  color: #9f4545;
}

.project-picker footer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  padding: 1px 4px 0;
}

.project-picker footer button {
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color var(--ui-duration-fast) var(--ui-ease-standard), color var(--ui-duration-fast) var(--ui-ease-standard);
}

.project-picker__hint {
  flex: 1 1 auto;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.project-picker__cancel:hover,
.project-picker__open:hover:not(:disabled) {
  background: var(--ui-surface-hover);
  color: var(--ui-text-strong);
}

.project-picker footer button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgb(74 70 63 / 14%);
}

.project-picker__open:disabled {
  cursor: default;
  opacity: 0.45;
}

@media (prefers-reduced-motion: reduce) {
  .project-picker__breadcrumb-segment,
  .project-picker__breadcrumb-sep,
  .project-picker__entry,
  .project-picker footer button,
  .project-picker__notice-close {
    transition: none;
  }
}
</style>
