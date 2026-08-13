<script setup lang="ts">
import AddIcon from "@/assets/icons/Add.svg";
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";
import CalendarScheduleIcon from "@/assets/icons/CalendarSchedule.svg";
import ChatNewIcon from "@/assets/icons/ChatNew.svg";
import CheckboxMultipleIcon from "@/assets/icons/CheckboxMultiple.svg";
import DeleteBinIcon from "@/assets/icons/DeleteBin.svg";
import FolderAddIcon from "@/assets/icons/FolderAdd.svg";
import FolderIcon from "@/assets/icons/Folder.svg";
import FolderOpenIcon from "@/assets/icons/FolderOpen.svg";
import InformationIcon from "@/assets/icons/Information.svg";
import More2Icon from "@/assets/icons/More2.svg";
import QuestionIcon from "@/assets/icons/Question.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import SettingsIcon from "@/assets/icons/Settings3.svg";
import SortDescIcon from "@/assets/icons/SortDesc.svg";
import { ArrowsMerge } from "@/components/ArrowsMerge";
import IconButton from "@/components/IconButton.vue";
import AboutModal from "@/components/modals/AboutModal.vue";
import ProjectPickerModal from "@/components/modals/ProjectPickerModal.vue";
import MenuPanel from "@/components/MenuPanel.vue";
import { usePopover } from "@/composables/usePopover";
import { pathBasename } from "@pichamber/shared";
import type { SessionInfo } from "@pichamber/shared";
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { ui } from "@/stores/ui";
import {
  createSessionForCwd,
  loadSessions,
  sessionTitle,
  sessions,
  sessionsError,
  sessionsLoading,
  workspace,
} from "@/stores/workspace";
import { settings } from "@/stores/settings";
import { deleteSession, toMessage } from "@/api/client";

const visibleSessions = computed(() => {
  if (!settings.hideTemporarySessions) return sessions.value;
  return sessions.value.filter((session) => !isTemporarySessionPath(session.cwd));
});

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
  height: 36,
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
      <div class="sidebar__search-group">
        <IconButton class="search-primary" label="Search" disabled><SearchIcon /></IconButton>
        <IconButton label="Search options" disabled><ArrowDownSIcon /></IconButton>
      </div>
    </div>

    <div class="sidebar__actions" aria-label="Workspace actions">
      <div>
        <IconButton label="Add project" @click="projectPickerOpen = true"><FolderAddIcon /></IconButton>
        <IconButton label="New session" @click="startProjectSession(workspace.cwd ?? '~')">
          <ChatNewIcon />
        </IconButton>
        <IconButton label="New multi-run" disabled><ArrowsMerge /></IconButton>
        <IconButton label="Scheduled tasks" disabled><CalendarScheduleIcon /></IconButton>
      </div>
      <div>
        <IconButton label="Search sessions" disabled><SearchIcon /></IconButton>
        <IconButton label="Select sessions" disabled><CheckboxMultipleIcon /></IconButton>
        <IconButton label="Sort projects" disabled><SortDescIcon /></IconButton>
      </div>
    </div>

    <section ref="sessionListRoot" class="session-list scroll-fade-bottom">
      <p v-if="sessionsLoading" class="session-list__state">Loading sessions...</p>
      <p v-else-if="sessionsError" class="session-list__state session-list__state--error">{{ sessionsError }}</p>
      <p v-else-if="visibleSessions.length === 0" class="session-list__state">No sessions yet.</p>

      <template v-else>
        <section v-for="project in projectGroups" :key="project.cwd" class="session-list__section">
          <div class="session-list__project-header">
            <button
              type="button"
              class="session-list__project"
              :aria-expanded="!collapsedProjects.has(project.cwd)"
              @click="toggleProject(project.cwd)"
            >
              <span
                class="session-list__project-folder"
                :class="{ 'is-open': !collapsedProjects.has(project.cwd) }"
              >
                <FolderIcon class="session-list__project-folder-icon session-list__project-folder-icon--closed" />
                <FolderOpenIcon class="session-list__project-folder-icon session-list__project-folder-icon--open" />
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
                :class="{
                  'is-active': isActive,
                  'is-menu-open': sessionMenuOpen && selectedSessionId === session.id,
                }"
                @click="closeSessionMenu(); navigate()"
              >
                <span class="session-list__title">{{ sessionTitle(session) }}</span>
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
      :height="36"
      aria-label="Session options"
    >
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
  grid-template-rows: 48px 40px minmax(0, 1fr) 42px;
  overflow: hidden;
  color: #1f1f1f;
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
  gap: 14px;
  align-items: center;
  padding: 7px var(--sidebar-gutter) 7px 48px;
}
.sidebar__search-group {
  display: flex;
  width: 68px;
  height: 28px;
  overflow: hidden;
  border: 1px solid #dfddd4;
  border-radius: 9px;
}
.sidebar__search-group > :deep(.icon-button) {
  border-radius: 0;
}
.sidebar__search-group > :deep(.icon-button + .icon-button) {
  flex: 0 0 28px;
  width: 28px;
  border-left: 1px solid #dfddd4;
}
.sidebar__search-group > :deep(.search-primary) {
  flex: 0 0 40px;
  width: 40px;
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
  color: #888;
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
  color: #222;
}
.session-list__project-header:is(:hover, :focus-within) .session-list__project {
  background: rgb(0 0 0 / 4%);
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
  color: #777;
  flex: 0 0 auto;
  transform-origin: 30% 65%;
  transition: transform 150ms ease-out, color 150ms ease-out;
}
.session-list__project-folder-icon {
  position: absolute;
  inset: 0;
  width: 14px;
  height: 14px;
  transform-origin: 30% 65%;
  overflow: visible;
  transition:
    opacity 150ms ease-out,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.session-list__project-folder-icon--closed {
  opacity: 1;
  transform: scale(1);
}
.session-list__project-folder-icon--open {
  opacity: 0;
  transform: translate(1px, 1px) scale(0.82);
}
.session-list__project-folder.is-open .session-list__project-folder-icon--closed {
  opacity: 0;
  transform: translate(-1px, -1px) scale(0.82);
}
.session-list__project-folder.is-open .session-list__project-folder-icon--open {
  opacity: 1;
  transform: translate(0) scale(1);
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
  background: rgb(0 0 0 / 7%);
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
.session-list__item:hover .session-list__title {
  color: #111;
  transform: translateX(1px);
}
.session-list__age {
  position: absolute;
  top: 50%;
  inset-inline-end: 4px;
  width: 24px;
  color: #888;
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
.session-list__more {
  display: block;
  margin-left: 20px;
  padding: 4px 8px;
  border-radius: 6px;
  color: #8b8b8b;
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}
.session-list__more:hover {
  background: rgb(0 0 0 / 4%);
}
.session-list__state {
  margin: 12px 8px 0 28px;
  color: #888;
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
  .session-list__project-folder,
  .session-list__project-folder-icon {
    transition: none;
  }
}
</style>
