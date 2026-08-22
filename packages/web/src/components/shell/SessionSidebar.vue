<script setup lang="ts">
import AddIcon from "@/assets/icons/Add.svg";
import ChatNewIcon from "@/assets/icons/ChatNew.svg";
import CheckboxMultipleIcon from "@/assets/icons/CheckboxMultiple.svg";
import DeleteBinIcon from "@/assets/icons/DeleteBin.svg";
import FolderAddIcon from "@/assets/icons/FolderAdd.svg";
import FileEditIcon from "@/assets/icons/FileEdit.svg";
import { MorphIcon } from "morphicons/vue";
import InformationIcon from "@/assets/icons/Information.svg";
import More2Icon from "@/assets/icons/More2.svg";
import QuestionIcon from "@/assets/icons/Question.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import SettingsIcon from "@/assets/icons/Settings3.svg";
import SortDescIcon from "@/assets/icons/SortDesc.svg";
import CloseIcon from "@/assets/icons/Close.svg";
import LogoMark, { LOGO_MARK_VIEW_BOX } from "@/components/ui/LogoMark";
import IconButton from "@/components/ui/IconButton.vue";
import { Check } from "@/components/ui/Check";
import SearchBox from "@/components/ui/SearchBox.vue";
import { splitHighlight } from "@/composables/highlight";
import AboutModal from "@/components/modals/AboutModal.vue";
import ProjectPickerModal from "@/components/modals/ProjectPickerModal.vue";
import MenuPanel from "@/components/ui/MenuPanel.vue";
import { usePopover } from "@/composables/usePopover";
import { pathBasename } from "@amagicpear/pichamber-shared";
import type { SessionInfo } from "@amagicpear/pichamber-shared";
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { ui } from "@/stores/ui";
import {
  createSessionForCwd,
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
import { lucideIcon } from "@/components/ui/lucideIcons";

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

const projectGroups = computed(() => {
  const groups = new Map<string, SessionInfo[]>();
  for (const session of visibleSessions.value) {
    const cwd = projectPath(session.cwd);
    const projectSessions = groups.get(cwd) ?? [];
    projectSessions.push(session);
    groups.set(cwd, projectSessions);
  }
  return [...groups.entries()]
    .map(([cwd, projectSessions]) => ({
      cwd,
      sessions: projectSessions.sort((a, b) => toTime(b.modified) - toTime(a.modified)),
    }))
    .sort((a, b) => {
      const aT = toTime(a.sessions[0]?.modified);
      const bT = toTime(b.sessions[0]?.modified);
      if (bT !== aT) return bT - aT;
      return projectName(a.cwd).localeCompare(projectName(b.cwd));
    });
});

const INITIAL_VISIBLE_SESSIONS = 5;
const SESSION_PAGE_SIZE = 5;
const collapsedProjects = ref(new Set<string>());
const visibleSessionCounts = ref(new Map<string, number>());

const toggleProject = (cwd: string) => {
  const next = new Set(collapsedProjects.value);
  if (next.has(cwd)) next.delete(cwd);
  else next.add(cwd);
  collapsedProjects.value = next;
};

const visibleProjectSessions = (cwd: string, projectSessions: SessionInfo[]) =>
  projectSessions.slice(0, visibleSessionCounts.value.get(cwd) ?? INITIAL_VISIBLE_SESSIONS);

const showMoreSessions = (cwd: string) => {
  const next = new Map(visibleSessionCounts.value);
  next.set(cwd, (next.get(cwd) ?? INITIAL_VISIBLE_SESSIONS) + SESSION_PAGE_SIZE);
  visibleSessionCounts.value = next;
};

const startProjectSession = async (cwd: string) => {
  closeSessionMenu();
  workspace.cwd = cwd;
  workspace.folderName = projectName(cwd);
  workspace.sessionName = "New Session";

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
const sessionListRoot = ref<HTMLElement | null>(null);
const selectedSessionId = ref<string | null>(null);
const {
  open: sessionMenuOpen,
  style: sessionMenuStyle,
  close: closeSessionMenu,
} = usePopover({
  root: sessionListRoot,
  trigger: ".session-list__menu-trigger.is-menu-target",
  panel: ".menu-panel",
  width: 180,
  height: 66,
});

const openSessionMenu = (sessionId: string) => {
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

const removeSelectedSession = async () => {
  const sessionId = selectedSessionId.value;
  if (!sessionId || !window.confirm("Delete this session?")) return;

  closeSessionMenu();
  try {
    await deleteSession(sessionId);
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    if (workspace.sessionId === sessionId) await router.push({ name: "new-session" });
  } catch (error) {
    sessionsError.value = toMessage(error);
  }
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
const projectPickerOpen = ref(false);

const openProject = async (cwd: string) => {
  projectPickerOpen.value = false;
  await startProjectSession(cwd);
};

onMounted(async () => {
  await loadSessions();
});
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__topbar">
      <svg class="sidebar__logo" :viewBox="LOGO_MARK_VIEW_BOX" width="22" height="22" aria-label="Pichamber" role="img">
        <LogoMark />
      </svg>
    </div>

    <div class="sidebar__actions" aria-label="Workspace actions">
      <div>
        <IconButton label="Add project" @click="projectPickerOpen = true"><FolderAddIcon /></IconButton>
        <IconButton label="New session" @click="startProjectSession(workspace.cwd ?? '~')">
          <ChatNewIcon />
        </IconButton>
      </div>
      <div>
        <IconButton label="Search sessions" :pressed="searchOpen" @click="toggleSessionSearch"><SearchIcon /></IconButton>
        <IconButton label="Select sessions" disabled><CheckboxMultipleIcon /></IconButton>
        <IconButton label="Sort projects" disabled><SortDescIcon /></IconButton>
      </div>
    </div>

    <div class="sidebar__searchbar" :class="{ 'is-open': searchOpen }">
      <SearchBox v-if="searchOpen" v-model="sessionSearch" placeholder="Search sessions..." label="Search sessions" autoFocus />
    </div>

    <section ref="sessionListRoot" class="session-list scroll-fade-bottom">
      <p v-if="sessionsLoading" class="session-list__state">Loading sessions...</p>
      <p v-else-if="sessionsError" class="session-list__state session-list__state--error">{{ sessionsError }}</p>
      <p v-else-if="sessions.length === 0" class="session-list__state">No sessions yet.</p>
      <p v-else-if="visibleSessions.length === 0" class="session-list__state">No sessions match &quot;{{ sessionSearch }}&quot;.</p>

      <template v-else>
        <section v-for="project in projectGroups" :key="project.cwd" class="session-list__section">
          <div class="session-list__project-header">
            <button
              type="button"
              class="session-list__project"
              :aria-expanded="!collapsedProjects.has(project.cwd)"
              @click="toggleProject(project.cwd)"
            >
              <span class="session-list__project-folder">
                <MorphIcon
                  :icon="collapsedProjects.has(project.cwd) ? lucideIcon('folder') : lucideIcon('folder-open')"
                  :size="14"
                  spring="snappy"
                  reduced-motion="user"
                />
              </span>
              <span class="session-list__project-title">{{ projectName(project.cwd) }}</span>
            </button>
            <IconButton
              class="session-list__project-new"
              label="New session in project"
              size="compact"
              @click.stop="startProjectSession(project.cwd)"
            >
              <AddIcon />
            </IconButton>
          </div>
          <template v-if="!collapsedProjects.has(project.cwd)">
            <RouterLink
              v-for="session in visibleProjectSessions(project.cwd, project.sessions)"
              :key="session.id"
              custom
              :to="{ name: 'session', params: { sessionId: session.id } }"
              v-slot="{ navigate, isActive }"
            >
              <div
                class="session-list__item"
                :class="[
                  {
                    'is-active': isActive,
                    'is-menu-open': sessionMenuOpen && selectedSessionId === session.id,
                    'is-renaming': renamingSessionId === session.id,
                  },
                ]"
                @click="closeSessionMenu(); navigate()"
              >
                <template v-if="renamingSessionId === session.id">
                  <input
                    ref="renamingRef"
                    v-model="renameInput"
                    class="session-list__rename-input"
                    aria-label="Rename session"
                    @click.stop
                    @keydown="onRenameEnter"
                  />
                  <span class="session-list__rename-controls">
                    <IconButton size="mini" label="Apply rename" @click.stop="applyRename">
                      <Check />
                    </IconButton>
                    <IconButton size="mini" label="Cancel rename" @click.stop="cancelRename">
                      <CloseIcon />
                    </IconButton>
                  </span>
                </template>
                <template v-else>
                  <span class="session-list__title">
                    <template v-for="(segment, i) in highlightTitle(sessionTitle(session))" :key="i">
                      <mark v-if="segment.hit" class="session-list__hit">{{ segment.text }}</mark>
                      <template v-else>{{ segment.text }}</template>
                    </template>
                  </span>
                  <span class="session-list__age">{{ sessionAge(session) }}</span>
                  <IconButton
                    class="session-list__menu-trigger"
                    :class="{ 'is-menu-target': sessionMenuOpen && selectedSessionId === session.id }"
                    label="Session options"
                    size="compact"
                    @click.stop="openSessionMenu(session.id)"
                  >
                    <More2Icon />
                  </IconButton>
                </template>
              </div>
            </RouterLink>
            <button
              v-if="project.sessions.length > visibleProjectSessions(project.cwd, project.sessions).length"
              type="button"
              class="session-list__more"
              @click="showMoreSessions(project.cwd)"
            >
              Show more sessions
            </button>
          </template>
        </section>
      </template>
    </section>

    <MenuPanel
      :open="sessionMenuOpen"
      :style="sessionMenuStyle"
      :width="180"
      :height="66"
      aria-label="Session options"
    >
      <button type="button" class="menu-item" role="menuitem" @click="beginRename(sessions.find(s => s.id === selectedSessionId))">
        <FileEditIcon />
        Rename
      </button>
      <button type="button" class="menu-item" role="menuitem" @click="removeSelectedSession">
        <DeleteBinIcon />
        Delete session
      </button>
    </MenuPanel>

    <footer class="sidebar__footer">
      <IconButton size="large" label="Settings" @click="ui.settingsOpen = true">
        <SettingsIcon />
      </IconButton>
      <IconButton size="large" label="Keyboard shortcuts" disabled><QuestionIcon /></IconButton>
      <IconButton size="large" label="About" @click="aboutOpen = true"><InformationIcon /></IconButton>
    </footer>

    <AboutModal :show="aboutOpen" @close="aboutOpen = false" />
    <ProjectPickerModal :show="projectPickerOpen" @close="projectPickerOpen = false" @select="openProject" />
  </aside>
</template>

<style scoped>
.sidebar {
  --sidebar-gutter: 8px;

  display: grid;
  width: 100%;
  height: 100%;
  grid-template-rows: 48px 40px auto minmax(0, 1fr) 42px;
  overflow: hidden;
  color: var(--ui-text);
  font-size: 14px;
}
.sidebar__topbar,
.sidebar__actions,
.sidebar__actions > div,
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
.sidebar__actions {
  justify-content: space-between;
  padding: 4px var(--sidebar-gutter);
}
.sidebar__actions > div {
  gap: 2px;
}
.sidebar__actions > div + div {
  padding-left: 8px;
}
.session-list {
  min-height: 0;
  padding: 6px var(--sidebar-gutter) 8px;
  overflow: auto;
}
.session-list__section + .session-list__section {
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
.session-list__project-new,
.session-list__menu-trigger {
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
.session-list__project-header:is(:hover, :focus-within) .session-list__project-new,
.session-list__item:is(:hover, .is-menu-open) .session-list__menu-trigger {
  opacity: 1;
  pointer-events: auto;
  transform: translate(0, -50%);
  color: var(--ui-text-strong);
}
.session-list__project-header:is(:hover, :focus-within) .session-list__project {
  background: var(--ui-surface-hover);
}
.session-list__project-header:is(:hover, :focus-within) :is(
  .session-list__project-folder,
  .session-list__project-title
) {
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
  display: flex;
  position: relative;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 30px;
  padding: 5px 36px 5px 28px;
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
.session-list__item.is-renaming {
  padding-right: 8px;
}
.session-list__item.is-renaming:hover .session-list__title {
  transform: none;
}
.session-list__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  transition:
    color 150ms ease-out,
    transform 150ms ease-out;
  white-space: nowrap;
}
.session-list__hit {
  padding: 0 1px;
  border-radius: 2px;
  background: var(--ui-accent-soft);
  color: var(--ui-accent-text);
}
.session-list__item:hover .session-list__title {
  color: var(--ui-text-strong);
  transform: translateX(1px);
}
.session-list__age {
  position: absolute;
  top: 50%;
  inset-inline-end: 4px;
  width: 24px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 20px;
  text-align: center;
  transform: translateY(-50%);
  white-space: nowrap;
  transition: opacity 120ms ease-out;
}
.session-list__item:is(:hover, .is-menu-open) .session-list__age {
  opacity: 0;
}
.session-list__rename-input {
  box-sizing: border-box;
  flex: 1 1 auto;
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
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin-inline-start: 6px;
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
