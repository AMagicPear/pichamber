<script setup lang="ts">
import ArrowDownSIcon from "@/assets/icons/ArrowDownS.svg";
import CalendarScheduleIcon from "@/assets/icons/CalendarSchedule.svg";
import ChatNewIcon from "@/assets/icons/ChatNew.svg";
import CheckboxMultipleIcon from "@/assets/icons/CheckboxMultiple.svg";
import FolderAddIcon from "@/assets/icons/FolderAdd.svg";
import InformationIcon from "@/assets/icons/Information.svg";
import QuestionIcon from "@/assets/icons/Question.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import SettingsIcon from "@/assets/icons/Settings3.svg";
import SortDescIcon from "@/assets/icons/SortDesc.svg";
import { ArrowsMerge } from "@/components/ArrowsMerge";
import IconButton from "@/components/IconButton.vue";
import AboutModal from "@/components/modals/AboutModal.vue";
import type { SessionInfo } from "@pichamber/shared";
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { ui } from "@/stores/ui";
import { loadSessions, sessionTitle, sessions, sessionsError, sessionsLoading } from "@/stores/workspace";
import { settings } from "@/stores/settings";
import { computed } from "vue";

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

const aboutOpen = ref(false);

onMounted(async () => {
  await loadSessions();
});
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar__topbar">
      <div class="sidebar__search-group">
        <IconButton class="search-primary" label="Search"><SearchIcon /></IconButton>
        <IconButton label="Search options"><ArrowDownSIcon /></IconButton>
      </div>
    </div>

    <div class="sidebar__actions" aria-label="Workspace actions">
      <div>
        <IconButton label="Add project"><FolderAddIcon /></IconButton>
        <RouterLink to="/new" custom v-slot="{ navigate }">
          <IconButton label="New session" @click="navigate"><ChatNewIcon /></IconButton>
        </RouterLink>
        <IconButton label="New multi-run"><ArrowsMerge /></IconButton>
        <IconButton label="Scheduled tasks"><CalendarScheduleIcon /></IconButton>
      </div>
      <div>
        <IconButton label="Search sessions"><SearchIcon /></IconButton>
        <IconButton label="Select sessions"><CheckboxMultipleIcon /></IconButton>
        <IconButton label="Sort projects"><SortDescIcon /></IconButton>
        <IconButton label="Display options"><SettingsIcon /></IconButton>
      </div>
    </div>

    <section class="session-list">
      <h2><ArrowDownSIcon /> <span>Recent</span></h2>
      <p v-if="sessionsLoading" class="session-list__state">Loading sessions...</p>
      <p v-else-if="sessionsError" class="session-list__state session-list__state--error">{{ sessionsError }}</p>
      <p v-else-if="visibleSessions.length === 0" class="session-list__state">No sessions yet.</p>
      <RouterLink
        v-for="session in visibleSessions"
        v-else
        :key="session.id"
        :to="{ name: 'session', params: { sessionId: session.id } }"
        class="session-list__item"
        active-class="is-active"
      >
        <span>{{ sessionTitle(session) }}</span>
        <time>{{ sessionAge(session) }}</time>
      </RouterLink>
    </section>

    <footer class="sidebar__footer">
      <IconButton size="large" label="Settings" @click="ui.settingsOpen = true">
        <SettingsIcon />
      </IconButton>
      <IconButton size="large" label="Keyboard shortcuts"><QuestionIcon /></IconButton>
      <IconButton size="large" label="About" @click="aboutOpen = true"><InformationIcon /></IconButton>
      <button type="button" class="sidebar__update">update</button>
    </footer>

    <AboutModal :show="aboutOpen" @close="aboutOpen = false" />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
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
  flex: 0 0 48px;
  gap: 14px;
  align-items: center;
  padding: 8px 14px 8px 48px;
}
.sidebar__search-group {
  display: flex;
  height: 30px;
  overflow: hidden;
  border: 1px solid #dfddd4;
  border-radius: 9px;
}
.sidebar__search-group > :deep(.icon-button) {
  border-radius: 0;
}
.sidebar__search-group > :deep(.icon-button + .icon-button) {
  border-left: 1px solid #dfddd4;
}
.sidebar__search-group > :deep(.search-primary) {
  width: 36px;
}
.sidebar__actions {
  flex: 0 0 40px;
  justify-content: space-between;
  padding: 4px 10px;
}
.sidebar__actions > div {
  gap: 2px;
}
.session-list {
  flex: 1;
  min-height: 0;
  padding: 8px 10px;
  overflow: auto;
}
.session-list h2 {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 400;
  line-height: 24px;
}
.session-list h2 svg {
  width: 14px;
  height: 14px;
  color: #777;
}
.session-list__item {
  display: flex;
  justify-content: space-between;
  width: 100%;
  min-height: 31px;
  padding: 6px 7px 6px 28px;
  border-radius: 6px;
  color: inherit;
  text-decoration: none;
  text-align: left;
  font-size: 14px;
  line-height: 19px;
}
.session-list__item.is-active,
.session-list__item.is-active:hover {
  background: rgb(0 0 0 / 7%);
}
.session-list__item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-list__item time {
  margin-left: 8px;
  color: #888;
  font-size: 12px;
  white-space: nowrap;
}
.session-list__more {
  padding: 5px 7px 5px 28px;
  color: #8b8b8b;
  font-size: 12px;
}
.session-list__state {
  margin: 12px 7px 0 28px;
  color: #888;
  font-size: 12px;
}
.session-list__state--error {
  color: #b3261e;
}
.sidebar__footer {
  flex: 0 0 42px;
  gap: 2px;
  padding: 5px 10px;
}
.sidebar__update {
  margin-left: auto;
  padding: 3px 9px;
  border: 1px solid #b7cbe0;
  border-radius: 7px;
  color: #315d91;
  font-size: 12px;
}
.session-list__item:hover,
.session-list__more:hover,
.sidebar__update:hover {
  background: rgb(0 0 0 / 4%);
}
</style>
