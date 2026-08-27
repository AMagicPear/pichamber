<script setup lang="ts">
import AddIcon from "lucide-static/icons/plus.svg";
import ChatNewIcon from "lucide-static/icons/message-square-plus.svg";
import CheckboxMultipleIcon from "lucide-static/icons/list-checks.svg";
import CopyIcon from "lucide-static/icons/copy.svg";
import DeleteBinIcon from "lucide-static/icons/trash-2.svg";
import FolderAddIcon from "lucide-static/icons/folder-plus.svg";
import FileEditIcon from "lucide-static/icons/file-pen.svg";
import { MorphIcon } from "morphicons/vue";
import InformationIcon from "lucide-static/icons/info.svg";
import More2Icon from "lucide-static/icons/more-horizontal.svg";
import QuestionIcon from "lucide-static/icons/circle-question-mark.svg";
import SearchIcon from "lucide-static/icons/search.svg";
import SettingsIcon from "lucide-static/icons/settings.svg";
import CloseIcon from "lucide-static/icons/x.svg";
import LogoMark, { LOGO_MARK_VIEW_BOX } from "@/components/ui/LogoMark";
import IconButton from "@/components/ui/IconButton.vue";
import CheckIcon from "lucide-static/icons/check.svg";
import SearchBox from "@/components/ui/SearchBox.vue";
import { splitHighlight } from "@/composables/highlight";
import AboutModal from "@/components/modals/AboutModal.vue";
import ConfirmModal from "@/components/modals/ConfirmModal.vue";
import KeyboardShortcutsModal from "@/components/modals/KeyboardShortcutsModal.vue";
import ProjectPickerModal from "@/components/modals/ProjectPickerModal.vue";
import FloatingPanel from "@/components/ui/FloatingPanel.vue";
import MenuPanel from "@/components/ui/MenuPanel.vue";
import { usePopover } from "@/composables/usePopover";
import { pathBasename } from "@amagicpear/pichamber-shared";
import type { SessionInfo } from "@amagicpear/pichamber-shared";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRouter } from "vue-router";
import { ui } from "@/stores/ui";
import {
  createSessionForCwd,
  copySessionToProject,
  loadSessions,
  renameSessionInStore,
  sessionTitle,
  sessions,
  sessionsError,
  sessionsLoading,
  workspace,
} from "@/stores/workspace";
import { settings } from "@/stores/settings";
import { deleteSession, toMessage } from "@/api/client";
import { lucideIcon } from "@/components/ui/morphIcons";
import type { LucideIconName } from "@/components/ui/morphIcons";
import { pushInfoToast } from "@/stores/extensionUi";

const { t } = useI18n();

const searchOpen = ref(false);
const sessionSearch = ref("");

const toggleSessionSearch = () => {
  searchOpen.value = !searchOpen.value;
  if (!searchOpen.value) sessionSearch.value = "";
};

const searchQuery = computed(() => sessionSearch.value.trim().toLowerCase());

/** A session matches when the query hits its title or any of its message text. */
const matchesSearch = (session: SessionInfo) => {
  if (!searchQuery.value) return true;
  const haystack = [
    sessionTitle(session),
    session.allMessagesText,
    session.firstMessage,
    session.name,
  ]
    .filter((v): v is string => Boolean(v))
    .join("\n")
    .toLowerCase();
  return haystack.includes(searchQuery.value);
};

const visibleSessions = computed(() => {
  const base = settings.hideTemporarySessions
    ? sessions.value.filter((session) => !isTemporarySessionPath(session.cwd))
    : sessions.value;
  return searchQuery.value ? base.filter(matchesSearch) : base;
});

/** Highlight the query within a session title for sidebar rendering. */
const highlightTitle = (title: string) => splitHighlight(title, searchQuery.value);

const isTemporarySessionPath = (cwd: string) =>
  cwd.startsWith("/private/tmp") ||
  cwd.startsWith("/tmp") ||
  /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/.test(cwd);

const toTime = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const sessionAge = (session: SessionInfo) => {
  const elapsed = Math.max(0, Date.now() - toTime(session.modified));
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
};

const projectPath = (cwd: string) => cwd.replace(/[\\/]+$/, "") || "/";

const projectName = (cwd: string) => {
  const trimmed = projectPath(cwd);
  // Cross-platform basename — on Windows `C:\Users\foo\projects\pichamber`
  // must still resolve to `pichamber`, not the entire drive path.
  const name = pathBasename(trimmed);
  return name || trimmed || "/";
};

type ProjectSort = "recent" | "name" | "name-reverse";
const projectSort = ref<ProjectSort>("recent");

const sortMenuIcon = computed<LucideIconName>(() => {
  if (projectSort.value === "name") return "arrow-down-a-z";
  if (projectSort.value === "name-reverse") return "arrow-up-a-z";
  return "arrow-down-wide-narrow";
});

type SessionGroup = {
  root: SessionInfo;
  /** All descendants flattened — direct children and grandchildren alike.
   *  Grandchildren never appear nested under their own parent in the UI;
   *  they live in the grandparent's list so the sidebar stays two-tier
   *  (parent + descendants) regardless of how deep the spawn chain is. */
  descendants: SessionInfo[];
};

/** Walk `parentSessionPath` upward until we hit a session that has no
 *  parent (or whose parent isn't in the snapshot). Used to attribute
 *  grandchild sessions to their topmost ancestor instead of their direct
 *  parent — so C (child of B, B child of A) shows up in A's list, not B's. */
const findRoot = (session: SessionInfo, byPath: Map<string, SessionInfo>): SessionInfo => {
  let current = session;
  const visited = new Set<string>();
  while (current.parentSessionPath && !visited.has(current.path)) {
    visited.add(current.path);
    const parent = byPath.get(current.parentSessionPath);
    if (!parent) return current;
    current = parent;
  }
  return current;
};

const projectGroups = computed(() => {
  // Re-attribute every session to its parent's project cwd so a subagent
  // spawn lands under the parent's project header, then bucket by cwd.
  const byPath = new Map<string, SessionInfo>();
  for (const session of visibleSessions.value) byPath.set(session.path, session);

  const byRootPath = new Map<string, SessionGroup>();
  for (const session of visibleSessions.value) {
    const root = findRoot(session, byPath);
    if (!byRootPath.has(root.path)) byRootPath.set(root.path, { root, descendants: [] });
    if (session.path !== root.path) byRootPath.get(root.path)!.descendants.push(session);
  }

  const byCwd = new Map<string, { cwd: string; groups: SessionGroup[] }>();
  for (const group of byRootPath.values()) {
    const cwd = projectPath(group.root.cwd);
    const bucket = byCwd.get(cwd) ?? { cwd, groups: [] };
    bucket.groups.push(group);
    byCwd.set(cwd, bucket);
  }

  for (const bucket of byCwd.values()) {
    bucket.groups.sort((a, b) => toTime(b.root.modified) - toTime(a.root.modified));
    for (const group of bucket.groups) {
      group.descendants.sort((a, b) => toTime(b.modified) - toTime(a.modified));
    }
  }

  return [...byCwd.values()].sort((a, b) => {
    if (projectSort.value === "name") return projectName(a.cwd).localeCompare(projectName(b.cwd));
    if (projectSort.value === "name-reverse") return projectName(b.cwd).localeCompare(projectName(a.cwd));
    const aT = toTime(a.groups[0]?.root.modified);
    const bT = toTime(b.groups[0]?.root.modified);
    if (bT !== aT) return bT - aT;
    return projectName(a.cwd).localeCompare(projectName(b.cwd));
  });
});

const INITIAL_VISIBLE_SESSIONS = 5;
const SESSION_PAGE_SIZE = 5;
const collapsedProjects = ref(new Set<string>());
const visibleSessionCounts = ref(new Map<string, number>());
/** `session.path` of every parent that currently has at least one child
 *  session nested beneath it. The chevron button and child-count badge read
 *  from this set; the row itself renders identically to a flat session. */
const collapsedSessions = ref(new Set<string>());
let collapsedSessionsInitialized = false;

watch(
  sessions,
  (snapshot) => {
    if (collapsedSessionsInitialized) return;
    const parents = new Set<string>();
    for (const session of snapshot) {
      if (session.parentSessionPath) parents.add(session.parentSessionPath);
    }
    collapsedSessions.value = parents;
    collapsedSessionsInitialized = true;
  },
  { immediate: true },
);

const toggleProject = (cwd: string) => {
  const next = new Set(collapsedProjects.value);
  if (next.has(cwd)) next.delete(cwd);
  else next.add(cwd);
  collapsedProjects.value = next;
};

const toggleSessionCollapse = (path: string, event: Event) => {
  event.stopPropagation();
  event.preventDefault();
  const next = new Set(collapsedSessions.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsedSessions.value = next;
};

type DisplayItem = {
  session: SessionInfo;
  isParent: boolean;
  isDescendant: boolean;
  descendantCount: number;
};

/** Flatten a project's groups into renderable rows: each root first, then
 *  its descendants inline. Roots beyond `INITIAL_VISIBLE_SESSIONS` are
 *  hidden until the user clicks "show more"; descendants always follow
 *  their root in full, so expanding never truncates the child list. */
const visibleProjectItems = (cwd: string, groups: SessionGroup[]): DisplayItem[] => {
  const budget = visibleSessionCounts.value.get(cwd) ?? INITIAL_VISIBLE_SESSIONS;
  const collapsed = collapsedSessions.value;
  const items: DisplayItem[] = [];
  const visibleGroups = groups.slice(0, budget);
  for (const group of visibleGroups) {
    items.push({
      session: group.root,
      isParent: group.descendants.length > 0,
      isDescendant: false,
      descendantCount: group.descendants.length,
    });
    if (group.descendants.length > 0 && !collapsed.has(group.root.path)) {
      for (const descendant of group.descendants) {
        items.push({ session: descendant, isParent: false, isDescendant: true, descendantCount: 0 });
      }
    }
  }
  return items;
};

const hasMoreRoots = (cwd: string, groups: SessionGroup[]) =>
  groups.length > (visibleSessionCounts.value.get(cwd) ?? INITIAL_VISIBLE_SESSIONS);

const showMoreSessions = (cwd: string) => {
  const next = new Map(visibleSessionCounts.value);
  next.set(cwd, (next.get(cwd) ?? INITIAL_VISIBLE_SESSIONS) + SESSION_PAGE_SIZE);
  visibleSessionCounts.value = next;
};

const startProjectSession = async (cwd: string) => {
  closeSessionMenu();
  workspace.cwd = cwd;
  workspace.folderName = projectName(cwd);
  workspace.sessionName = t('sidebar.newSessionLabel');

  if (router.currentRoute.value.name === "new-session") {
    try {
      const sessionId = await createSessionForCwd(cwd);
      workspace.sessionId = sessionId;
      await router.replace({ name: "session", params: { sessionId } });
    } catch (error) {
      sessionsError.value = toMessage(error);
    }
    return;
  }

  await router.push({ name: "new-session" });
};

const router = useRouter();
const sidebarRoot = ref<HTMLElement | null>(null);
const sessionListRoot = ref<HTMLElement | null>(null);
const selectedSessionId = ref<string | null>(null);
const deleteConfirmOpen = ref(false);
const pendingDeleteSessionId = ref<string | null>(null);
const selectionMode = ref(false);
const selectedSessionIds = ref(new Set<string>());
const bulkDeleteConfirmOpen = ref(false);
const selectedSessionCount = computed(() => selectedSessionIds.value.size);
const allVisibleSessionsSelected = computed(() =>
  visibleSessions.value.length > 0 && visibleSessions.value.every((session) => selectedSessionIds.value.has(session.id)),
);
const {
  open: sessionMenuOpen,
  style: sessionMenuStyle,
  close: closeSessionMenu,
  panelId: sessionMenuPanelId,
} = usePopover({
  root: sessionListRoot,
  trigger: ".session-list__menu-trigger.is-menu-target",
  panel: ".floating-panel",
  width: 180,
});

const openSessionMenu = (sessionId: string) => {
  if (selectionMode.value) return;
  if (sessionMenuOpen.value && selectedSessionId.value === sessionId) {
    closeSessionMenu();
    return;
  }
  closeSessionMenu();
  selectedSessionId.value = sessionId;
  nextTick(() => {
    sessionMenuOpen.value = true;
  });
};

const toggleSelectionMode = () => {
  selectionMode.value = !selectionMode.value;
  selectedSessionIds.value = new Set();
  closeSessionMenu();
  closeSortMenu();
  cancelRename();
};

const toggleSessionSelection = (sessionId: string) => {
  const next = new Set(selectedSessionIds.value);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  selectedSessionIds.value = next;
};

const toggleSelectAllVisibleSessions = () => {
  selectedSessionIds.value = allVisibleSessionsSelected.value
    ? new Set()
    : new Set(visibleSessions.value.map((session) => session.id));
};

const removeSelectedSession = async () => {
  const sessionId = pendingDeleteSessionId.value;
  if (!sessionId) return;

  deleteConfirmOpen.value = false;
  pendingDeleteSessionId.value = null;
  try {
    await deleteSession(sessionId);
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    if (workspace.sessionId === sessionId) await router.push({ name: "new-session" });
  } catch (error) {
    sessionsError.value = toMessage(error);
  }
};

const requestDeleteSelectedSession = () => {
  if (!selectedSessionId.value) return;
  pendingDeleteSessionId.value = selectedSessionId.value;
  closeSessionMenu();
  deleteConfirmOpen.value = true;
};

const cancelDeleteSession = () => {
  deleteConfirmOpen.value = false;
  pendingDeleteSessionId.value = null;
};

const requestBulkDelete = () => {
  if (selectedSessionCount.value === 0) return;
  bulkDeleteConfirmOpen.value = true;
};

const removeSelectedSessions = async () => {
  const ids = [...selectedSessionIds.value];
  if (ids.length === 0) return;

  bulkDeleteConfirmOpen.value = false;
  const results = await Promise.allSettled(ids.map((id) => deleteSession(id)));
  const deletedIds = new Set(ids.filter((_, index) => results[index]?.status === "fulfilled"));
  const failedResult = results.find((result) => result.status === "rejected");
  sessions.value = sessions.value.filter((session) => !deletedIds.has(session.id));
  selectedSessionIds.value = new Set(ids.filter((id) => !deletedIds.has(id)));
  if (workspace.sessionId && deletedIds.has(workspace.sessionId)) await router.push({ name: "new-session" });
  if (failedResult?.status === "rejected") sessionsError.value = toMessage(failedResult.reason);
  else selectionMode.value = false;
};

const cancelBulkDelete = () => {
  bulkDeleteConfirmOpen.value = false;
};

const {
  open: sortMenuOpen,
  style: sortMenuStyle,
  close: closeSortMenu,
  panelId: sortMenuPanelId,
} = usePopover({
  root: sidebarRoot,
  trigger: ".sidebar__sort-trigger",
  panel: ".floating-panel",
  width: 190,
});

const sortMenuGroups = computed(() => [{
  id: "sort",
  items: [
    { id: "recent", label: t("sidebar.sortByRecent"), value: "recent", active: projectSort.value === "recent" },
    { id: "name", label: t("sidebar.sortByName"), value: "name", active: projectSort.value === "name" },
    { id: "name-reverse", label: t("sidebar.sortByNameReverse"), value: "name-reverse", active: projectSort.value === "name-reverse" },
  ],
}]);

const toggleSortMenu = () => {
  closeSessionMenu();
  sortMenuOpen.value = !sortMenuOpen.value;
};

const selectProjectSort = (item: { value: string }) => {
  if (item.value !== "recent" && item.value !== "name" && item.value !== "name-reverse") return;
  projectSort.value = item.value;
  closeSortMenu();
};

// ─── Inline rename ────────────────────────────────────────────────────
// Selecting "Rename" from the session menu swaps the row's title + right-side
// controls (age + more-menu) for a text input flanked by a check (apply) and
// a cross (cancel).
const renamingSessionId = ref<string | null>(null);
const renameInput = ref("");
const renamingRef = ref<HTMLInputElement | null>(null);

const beginRename = (session: SessionInfo | undefined) => {
  if (!session) return;
  closeSessionMenu();
  renamingSessionId.value = session.id;
  renameInput.value = sessionTitle(session);
  nextTick(() => {
    renamingRef.value?.focus();
    renamingRef.value?.select();
  });
};

const sessionMenuGroups = computed(() => [{
  id: "actions",
  items: [
    { id: "rename", label: t('sidebar.rename'), value: "rename", icon: FileEditIcon },
    { id: "copy", label: t('sidebar.copySessionToProject'), value: "copy", icon: CopyIcon },
    { id: "delete", label: t('sidebar.deleteSession'), value: "delete", icon: DeleteBinIcon },
  ],
}]);

const selectSessionMenuItem = (item: { value: string }) => {
  if (item.value === "rename") {
    beginRename(sessions.value.find((session: SessionInfo) => session.id === selectedSessionId.value));
  } else if (item.value === "copy") {
    const session = sessions.value.find((candidate: SessionInfo) => candidate.id === selectedSessionId.value);
    if (!session) return;
    copyTargetSessionId.value = session.id;
    projectPickerInitialPath.value = session.cwd;
    closeSessionMenu();
    projectPickerOpen.value = true;
  } else {
    requestDeleteSelectedSession();
  }
};

const applyRename = async () => {
  const sessionId = renamingSessionId.value;
  if (!sessionId) return;
  const name = renameInput.value.trim();
  renamingSessionId.value = null;
  if (!name) return; // empty → revert without persisting
  try {
    await renameSessionInStore(sessionId, name);
  } catch (error) {
    sessionsError.value = toMessage(error);
  }
};

const cancelRename = () => {
  renamingSessionId.value = null;
  renameInput.value = "";
};

const onRenameEnter = (event: KeyboardEvent) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void applyRename();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancelRename();
  }
};

const aboutOpen = ref(false);
const keyboardShortcutsOpen = ref(false);
const projectPickerOpen = ref(false);
const copyTargetSessionId = ref<string | null>(null);
const projectPickerInitialPath = ref<string | undefined>();

const openProject = async (cwd: string) => {
  projectPickerOpen.value = false;
  const sessionId = copyTargetSessionId.value;
  copyTargetSessionId.value = null;
  if (sessionId) {
    try {
      const copy = await copySessionToProject(sessionId, cwd);
      pushInfoToast(t('sidebar.copySessionSuccess', { project: projectName(copy.cwd) }));
    } catch (error) {
      sessionsError.value = toMessage(error);
    }
    return;
  }
  await startProjectSession(cwd);
};

const closeProjectPicker = () => {
  projectPickerOpen.value = false;
  copyTargetSessionId.value = null;
  projectPickerInitialPath.value = undefined;
};

onMounted(async () => {
  await loadSessions();
});
</script>

<template>
  <aside ref="sidebarRoot" class="sidebar">
    <div class="sidebar__topbar">
      <svg class="sidebar__logo" :viewBox="LOGO_MARK_VIEW_BOX" width="22" height="22" aria-label="Pi Chamber" role="img">
        <LogoMark />
      </svg>
    </div>

    <div class="sidebar__actions" :aria-label="t('sidebar.workspaceActions')">
      <div>
        <IconButton :label="t('sidebar.addProject')" @click="projectPickerInitialPath = undefined; projectPickerOpen = true">
          <FolderAddIcon />
        </IconButton>
        <IconButton :label="t('sidebar.newSession')" @click="startProjectSession(workspace.cwd ?? '~')">
          <ChatNewIcon />
        </IconButton>
      </div>
      <div>
        <IconButton :label="t('sidebar.searchSessions')" :pressed="searchOpen" @click="toggleSessionSearch">
          <SearchIcon />
        </IconButton>
        <IconButton :label="t('sidebar.selectSessions')" :pressed="selectionMode" @click="toggleSelectionMode">
          <CheckboxMultipleIcon />
        </IconButton>
        <IconButton class="sidebar__sort-trigger" :label="t('sidebar.sortProjects')" :pressed="sortMenuOpen" @click="toggleSortMenu">
          <MorphIcon :icon="lucideIcon(sortMenuIcon)" spring="snappy" />
        </IconButton>
      </div>
    </div>

    <div class="sidebar__searchbar" :class="{ 'is-open': searchOpen }">
      <SearchBox v-if="searchOpen" v-model="sessionSearch" :placeholder="t('sidebar.searchPlaceholder')" :label="t('sidebar.searchSessions')"
        autoFocus />
    </div>
    <div class="sidebar__selectionbar" :class="{ 'is-open': selectionMode }">
      <span class="sidebar__selectionbar-count">{{ t('sidebar.selectedSessions', { count: selectedSessionCount }) }}</span>
      <button type="button" @click="toggleSelectAllVisibleSessions">
        {{ allVisibleSessionsSelected ? t('sidebar.clearSelection') : t('sidebar.selectAllSessions') }}
      </button>
      <IconButton size="compact" :label="t('sidebar.deleteSelectedSessions', { count: selectedSessionCount })" :disabled="selectedSessionCount === 0" tone="danger" @click="requestBulkDelete">
        <DeleteBinIcon />
      </IconButton>
    </div>

    <section ref="sessionListRoot" class="session-list scroll-fade-bottom">
      <p v-if="sessionsLoading" class="session-list__state">{{ t('sidebar.loadingSessions') }}</p>
      <p v-else-if="sessionsError" class="session-list__state session-list__state--error">{{ sessionsError }}</p>
      <p v-else-if="sessions.length === 0" class="session-list__state">{{ t('sidebar.noSessionsYet') }}</p>
      <p v-else-if="visibleSessions.length === 0" class="session-list__state">{{ t('sidebar.noSessionsMatch', { query: sessionSearch }) }}</p>

      <template v-else>
        <section v-for="project in projectGroups" :key="project.cwd" class="session-list__section">
          <div class="session-list__project-header">
            <button type="button" class="session-list__project" :aria-expanded="!collapsedProjects.has(project.cwd)"
              @click="toggleProject(project.cwd)">
              <span class="session-list__project-folder">
                <MorphIcon :icon="collapsedProjects.has(project.cwd) ? lucideIcon('folder') : lucideIcon('folder-open')"
                  :size="14" spring="snappy" reduced-motion="user" />
              </span>
              <span class="session-list__project-title">{{ projectName(project.cwd) }}</span>
            </button>
            <IconButton class="session-list__project-new" :label="t('sidebar.newSessionInProject')" size="compact"
              @click.stop="startProjectSession(project.cwd)">
              <AddIcon />
            </IconButton>
          </div>
          <template v-if="!collapsedProjects.has(project.cwd)">
            <RouterLink v-for="item in visibleProjectItems(project.cwd, project.groups)" :key="item.session.id"
              custom :to="{ name: 'session', params: { sessionId: item.session.id } }" v-slot="{ navigate, isActive }">
              <div class="session-list__item" :class="[
                {
                  'is-active': isActive,
                  'is-menu-open': sessionMenuOpen && selectedSessionId === item.session.id,
                  'is-renaming': renamingSessionId === item.session.id,
                  'is-selected': selectionMode && selectedSessionIds.has(item.session.id),
                  'is-selecting': selectionMode,
                  'is-descendant': item.isDescendant,
                },
              ]" @click="selectionMode ? toggleSessionSelection(item.session.id) : (closeSessionMenu(), navigate())">
                <template v-if="renamingSessionId === item.session.id">
                  <span class="session-list__control-slot" aria-hidden="true" />
                  <input ref="renamingRef" v-model="renameInput" class="session-list__rename-input"
                    :aria-label="t('sidebar.renameSession')" @click.stop @keydown="onRenameEnter" />
                  <span class="session-list__rename-controls">
                    <IconButton size="mini" :label="t('sidebar.applyRename')" @click.stop="applyRename">
                      <CheckIcon />
                    </IconButton>
                    <IconButton size="mini" :label="t('sidebar.cancelRename')" @click.stop="cancelRename">
                      <CloseIcon />
                    </IconButton>
                  </span>
                </template>
                <template v-else>
                  <span class="session-list__control-slot">
                    <IconButton v-if="item.isParent && !selectionMode" size="mini" :label="t('sidebar.toggleSubSessions')"
                      :aria-expanded="!collapsedSessions.has(item.session.path)" @click="toggleSessionCollapse(item.session.path, $event)">
                      <MorphIcon :icon="collapsedSessions.has(item.session.path) ? lucideIcon('chevron-right') : lucideIcon('chevron-down')"
                        :size="12" spring="snappy" reduced-motion="user" />
                    </IconButton>
                    <input v-else-if="selectionMode" class="session-list__checkbox" type="checkbox" :checked="selectedSessionIds.has(item.session.id)"
                      :aria-label="t('sidebar.selectSession', { title: sessionTitle(item.session) })" @click.stop @change="toggleSessionSelection(item.session.id)" />
                  </span>
                  <span class="session-list__title">
                    <template v-for="(segment, i) in highlightTitle(sessionTitle(item.session))" :key="i">
                      <mark v-if="segment.hit" class="session-list__hit">{{ segment.text }}</mark>
                      <template v-else>{{ segment.text }}</template>
                    </template>
                  </span>
                  <span v-if="item.isParent && !selectionMode" class="session-list__child-count" aria-hidden="true">{{ item.descendantCount }}</span>
                  <span v-if="!selectionMode" class="session-list__age">{{ sessionAge(item.session) }}</span>
                  <IconButton v-if="!selectionMode" class="session-list__menu-trigger"
                    :class="{ 'is-menu-target': sessionMenuOpen && selectedSessionId === item.session.id }"
                    :label="t('sidebar.sessionOptions')" size="compact" @click.stop="openSessionMenu(item.session.id)">
                    <More2Icon />
                  </IconButton>
                </template>
              </div>
            </RouterLink>
            <button v-if="hasMoreRoots(project.cwd, project.groups)"
              type="button" class="session-list__more" @click="showMoreSessions(project.cwd)">
              {{ t('sidebar.showMoreSessions') }}
            </button>
          </template>
        </section>
      </template>
    </section>

    <FloatingPanel :open="sessionMenuOpen" :style="sessionMenuStyle" :width="180" :panel-id="sessionMenuPanelId" :aria-label="t('sidebar.sessionOptions')">
      <MenuPanel :groups="sessionMenuGroups" @select="selectSessionMenuItem" />
    </FloatingPanel>
    <FloatingPanel :open="sortMenuOpen" :style="sortMenuStyle" :width="190" :panel-id="sortMenuPanelId" :aria-label="t('sidebar.sortProjects')">
      <MenuPanel :groups="sortMenuGroups" @select="selectProjectSort" />
    </FloatingPanel>

    <footer class="sidebar__footer">
      <IconButton size="standard" :label="t('sidebar.settings')" @click="ui.settingsOpen = true">
        <SettingsIcon />
      </IconButton>
      <IconButton size="standard" :label="t('sidebar.keyboardShortcuts')" @click="keyboardShortcutsOpen = true">
        <QuestionIcon />
      </IconButton>
      <IconButton size="standard" :label="t('sidebar.about')" @click="aboutOpen = true">
        <InformationIcon />
      </IconButton>
    </footer>

    <AboutModal :show="aboutOpen" @close="aboutOpen = false" />
    <KeyboardShortcutsModal :show="keyboardShortcutsOpen" @close="keyboardShortcutsOpen = false" />
    <ProjectPickerModal :show="projectPickerOpen" :initial-path="projectPickerInitialPath" @close="closeProjectPicker" @select="openProject" />
    <ConfirmModal
      :show="deleteConfirmOpen"
      :title="t('sidebar.deleteConfirmTitle')"
      :message="t('sidebar.deleteConfirmMessage')"
      :confirm-label="t('sidebar.deleteSession')"
      @close="cancelDeleteSession"
      @confirm="removeSelectedSession"
    />
    <ConfirmModal
      :show="bulkDeleteConfirmOpen"
      :title="t('sidebar.deleteSelectedConfirmTitle')"
      :message="t('sidebar.deleteSelectedConfirmMessage', { count: selectedSessionCount })"
      :confirm-label="t('sidebar.deleteSelectedSessions', { count: selectedSessionCount })"
      @close="cancelBulkDelete"
      @confirm="removeSelectedSessions"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  --sidebar-gutter: 8px;

  display: grid;
  width: 100%;
  height: 100%;
  grid-template-rows: 48px 40px auto auto minmax(0, 1fr) 42px;
  overflow: hidden;
  color: var(--ui-text);
  font-size: 14px;
}

.sidebar__topbar,
.sidebar__actions,
.sidebar__actions>div,
.sidebar__footer {
  display: flex;
  align-items: center;
}

.sidebar__topbar {
  padding-left: 52px;
}

.sidebar__searchbar {
  height: 0;
  padding: 0;
  overflow: hidden;
  transition: height var(--ui-duration-medium) var(--ui-ease-emphasized), padding var(--ui-duration-medium) var(--ui-ease-emphasized);
}

.sidebar__searchbar.is-open {
  height: calc(var(--ui-input-height) + 8px);
  padding: 6px var(--sidebar-gutter) 2px;
}

.sidebar__selectionbar {
  display: flex;
  height: 0;
  align-items: center;
  gap: 6px;
  padding: 0 var(--sidebar-gutter);
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 12px;
  transition: height var(--ui-duration-medium) var(--ui-ease-emphasized), padding var(--ui-duration-medium) var(--ui-ease-emphasized);
}

.sidebar__selectionbar.is-open {
  height: 32px;
  padding: 4px var(--sidebar-gutter) 2px;
}

.sidebar__selectionbar-count {
  min-width: 0;
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar__selectionbar button:not(.icon-button) {
  flex: 0 0 auto;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-text-strong);
  font: inherit;
  cursor: pointer;
}

.sidebar__selectionbar button:not(.icon-button):hover {
  background: var(--ui-surface-hover);
}

.sidebar__actions {
  justify-content: space-between;
  padding: 4px var(--sidebar-gutter);
}

.sidebar__actions>div {
  gap: 2px;
}

.sidebar__actions>div+div {
  padding-left: 8px;
}

.session-list {
  min-height: 0;
  padding: 6px var(--sidebar-gutter) 8px;
  overflow: auto;
}

.session-list__section+.session-list__section {
  margin-top: 6px;
}

.session-list__project-header {
  position: relative;
}

.session-list__project {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 30px;
  margin: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 450;
  line-height: 20px;
  padding-right: 36px;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.session-list__project-new {
  position: absolute;
  top: 50%;
  inset-inline-end: 4px;
  width: 24px;
  height: 24px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  transform: translate(3px, -50%);
  color: var(--ui-text-muted);
  transition:
    transform 150ms ease-out,
    opacity 150ms ease-out;
}

.session-list__project-new :deep(svg),
.session-list__menu-trigger :deep(svg) {
  width: 13px;
  height: 13px;
}

.session-list__item .session-list__menu-trigger {
  position: static;
  grid-column: 4;
  grid-row: 1;
  justify-self: center;
  width: 20px;
  height: 20px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  transform: translateX(3px);
  color: var(--ui-text-muted);
  transition:
    transform 150ms ease-out,
    opacity 150ms ease-out;
}

.session-list__project-header:is(:hover, :focus-within) .session-list__project-new {
  opacity: 1;
  pointer-events: auto;
  transform: translate(0, -50%);
  color: var(--ui-text-strong);
}

.session-list__item:is(:hover, .is-menu-open) .session-list__menu-trigger {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
  color: var(--ui-text-strong);
}

.session-list__project-header:is(:hover, :focus-within) .session-list__project {
  background: var(--ui-surface-hover);
}

.session-list__project-header:is(:hover, :focus-within) :is(.session-list__project-folder,
  .session-list__project-title) {
  transform: translateX(1px);
}

.session-list__project-new:hover:not(:disabled),
.session-list__menu-trigger:hover:not(:disabled) {
  background: transparent;
  box-shadow: none;
}

.session-list__project-folder {
  position: relative;
  display: block;
  width: 14px;
  height: 14px;
  color: inherit;
  flex: 0 0 auto;
  transition: transform 150ms ease-out;
}

.session-list__project-title {
  transition: transform 150ms ease-out;
}

.session-list__item {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto 24px;
  column-gap: 4px;
  align-items: center;
  width: 100%;
  min-height: 28px;
  padding: 3px 4px;
  border-radius: 6px;
  color: inherit;
  text-decoration: none;
  text-align: left;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.session-list__item.is-active,
.session-list__item.is-active:hover {
  background: var(--ui-surface-selected);
}

.session-list__item.is-selected {
  background: var(--ui-surface-hover);
}

.session-list__item.is-descendant { grid-template-columns: 28px minmax(0, 1fr) auto 24px; }

.session-list__item.is-renaming:hover .session-list__title {
  transform: none;
}

.session-list__title {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    color 150ms ease-out,
    transform 150ms ease-out;
  white-space: nowrap;
}

.session-list__control-slot {
  display: flex;
  grid-column: 1;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
}

.session-list__child-count {
  grid-column: 3;
  min-width: 16px;
  padding: 0 5px;
  height: 16px;
  border-radius: 8px;
  background: var(--ui-surface-hover);
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.session-list__checkbox {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--ui-primary);
  transition: transform 150ms ease-out;
}

.session-list__item.is-selecting:hover .session-list__checkbox {
  transform: translateX(1px);
}

.session-list__hit {
  padding: 0 1px;
  border-radius: 2px;
  background: var(--ui-accent-soft);
  color: var(--ui-accent-text);
}

.session-list__item:hover .session-list__title,
.session-list__item:hover .session-list__control-slot {
  color: var(--ui-text-strong);
  transform: translateX(1px);
}

.session-list__age {
  grid-column: 4;
  grid-row: 1;
  width: 24px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 20px;
  text-align: center;
  white-space: nowrap;
  transition: opacity 120ms ease-out;
}

.session-list__item:is(:hover, .is-menu-open) .session-list__age {
  opacity: 0;
}

.session-list__rename-input {
  box-sizing: border-box;
  grid-column: 2;
  min-width: 0;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  vertical-align: middle;
}

.session-list__rename-controls {
  display: flex;
  grid-column: 3;
  align-items: center;
  gap: 4px;
}

.session-list__more {
  display: block;
  margin-left: 20px;
  padding: 4px 8px;
  border-radius: 6px;
  color: var(--ui-text-muted);
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}

.session-list__more:hover {
  background: var(--ui-surface-hover);
}

.session-list__state {
  margin: 12px 8px 0 28px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.session-list__state--error {
  color: #b3261e;
}

.sidebar__footer {
  gap: 2px;
  padding: 5px var(--sidebar-gutter);
}

@media (prefers-reduced-motion: reduce) {
  .session-list__project-folder {
    transition: none;
  }
}
</style>
