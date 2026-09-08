/**
 * Sidebar session grouping, sorting, search, and collapse state.
 *
 * `SessionSidebar.vue` renders rows and owns menus/rename/delete; this module
 * owns *which* sessions are visible and how they are bucketed. The grouping
 * algorithm is pure enough to unit-test without mounting the component
 * (`useSessionGroups.test.ts`).
 */
import { computed, ref, watch } from "vue";
import type { SessionInfo } from "@amagicpear/pichamber-shared";
import { pathBasename, pathTrimTrailing } from "@amagicpear/pichamber-shared";
import { splitHighlight } from "@/composables/highlight";
import type { LucideIconName } from "@/components/ui/morphIcons";
import { sessions, sessionTitle } from "@/stores/workspace";
import { settings } from "@/stores/settings";

export type ProjectSort = "recent" | "name" | "name-reverse";

const INITIAL_VISIBLE_SESSIONS = 5;
const SESSION_PAGE_SIZE = 5;

/** Project grouping: a root session plus every descendant re-attributed to it
 *  (grandchildren never nest under their direct parent — the sidebar stays
 *  two-tier regardless of spawn depth). */
export type SessionGroup = {
  root: SessionInfo;
  descendants: SessionInfo[];
};

export type DisplayItem = {
  session: SessionInfo;
  isParent: boolean;
  isDescendant: boolean;
  descendantCount: number;
};

export const isTemporarySessionPath = (cwd: string) =>
  cwd.startsWith("/private/tmp") ||
  cwd.startsWith("/tmp") ||
  /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/.test(cwd);

const toTime = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
};

/** Compact age label for a session row: "3m", "5h", "2d", "4mo", "1y". */
export const sessionAge = (session: SessionInfo) => {
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

const projectPath = (cwd: string) => pathTrimTrailing(cwd) || "/";

/** Cross-platform basename — on Windows `C:\Users\foo\projects\pichamber`
 *  must still resolve to `pichamber`, not the entire drive path. */
export const projectName = (cwd: string) => {
  const trimmed = projectPath(cwd);
  return pathBasename(trimmed) || trimmed || "/";
};

/** A project is "missing" when none of its sessions point at a cwd that
 *  still exists on disk. The "+ new session" action has no usable target for
 *  those, so the button is disabled instead of letting the server 404. */
export const isMissingProjectCwd = (groups: SessionGroup[]) =>
  groups.length > 0 && groups.every((group) => group.root.cwdAvailable === false);

/** Windows paths are case-insensitive, so group them case-insensitively
 *  regardless of the browser's OS — the paths come from the server, not the
 *  browser, so the browser's userAgent is the wrong signal. */
const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\");
const cwdCompareKey = (cwd: string) => {
  const trimmed = projectPath(cwd);
  return isWindowsPath(trimmed) ? trimmed.toLowerCase() : trimmed;
};

/** Walk `parentSessionPath` upward until a session with no parent (or whose
 *  parent isn't in the snapshot). Cross-project forks keep `parentSessionPath`
 *  but change cwd, so the chain stops there — they belong to their own
 *  project bucket, not the source project. */
const findRoot = (session: SessionInfo, byPath: Map<string, SessionInfo>): SessionInfo => {
  let current = session;
  const visited = new Set<string>();
  while (current.parentSessionPath && !visited.has(current.path)) {
    visited.add(current.path);
    const parent = byPath.get(current.parentSessionPath);
    if (!parent) return current;
    if (cwdCompareKey(current.cwd) !== cwdCompareKey(parent.cwd)) return current;
    current = parent;
  }
  return current;
};

export const useSessionGroups = () => {
  const sessionSearch = ref("");
  const projectSort = ref<ProjectSort>("recent");
  const collapsedProjects = ref(new Set<string>());
  const visibleSessionCounts = ref(new Map<string, number>());
  /** `session.path` of every parent that currently has at least one child
   *  session nested beneath it. */
  const collapsedSessions = ref(new Set<string>());

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

  const projectGroups = computed(() => {
    const byPath = new Map<string, SessionInfo>();
    for (const session of visibleSessions.value) byPath.set(session.path, session);

    const byRootPath = new Map<string, SessionGroup>();
    for (const session of visibleSessions.value) {
      const root = findRoot(session, byPath);
      // Multiple independent root sessions can share one cwd. Keep them as
      // separate conversation groups; cwd is only the outer project bucket.
      const key = root.path;
      if (!byRootPath.has(key)) byRootPath.set(key, { root, descendants: [] });
      if (session.path !== root.path) byRootPath.get(key)!.descendants.push(session);
    }

    const byCwd = new Map<string, { cwd: string; groups: SessionGroup[] }>();
    for (const group of byRootPath.values()) {
      const displayCwd = projectPath(group.root.cwd);
      const key = cwdCompareKey(group.root.cwd);
      const bucket = byCwd.get(key) ?? { cwd: displayCwd, groups: [] };
      bucket.groups.push(group);
      byCwd.set(key, bucket);
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

  const sortMenuIcon = computed<LucideIconName>(() => {
    if (projectSort.value === "name") return "arrow-down-a-z";
    if (projectSort.value === "name-reverse") return "arrow-up-a-z";
    return "arrow-down-wide-narrow";
  });

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

  /** Flatten a project's groups into renderable rows: each root first, then
   *  its descendants inline. Roots beyond the per-project budget are hidden
   *  until "show more"; descendants always follow their root in full, so
   *  expanding never truncates the child list. */
  const visibleProjectItems = (cwd: string, groups: SessionGroup[]): DisplayItem[] => {
    const budget = visibleSessionCounts.value.get(cwd) ?? INITIAL_VISIBLE_SESSIONS;
    const collapsed = collapsedSessions.value;
    const items: DisplayItem[] = [];
    for (const group of groups.slice(0, budget)) {
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

  return {
    sessionSearch,
    projectSort,
    collapsedProjects,
    collapsedSessions,
    sortMenuIcon,
    visibleSessions,
    projectGroups,
    highlightTitle,
    toggleProject,
    toggleSessionCollapse,
    visibleProjectItems,
    hasMoreRoots,
    showMoreSessions,
  };
};
