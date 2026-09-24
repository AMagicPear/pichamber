import { afterEach, describe, expect, test } from "bun:test";
import type { SessionInfo } from "@amagicpear/pichamber-shared";
import { isMissingProjectCwd, isTemporarySessionPath, projectName, sessionAge, useSessionGroups } from "@/composables/useSessionGroups";
import { sessions } from "@/stores/workspace";
import { settings } from "@/stores/settings";

const session = (overrides: Partial<SessionInfo> & Pick<SessionInfo, "path" | "cwd">): SessionInfo => ({
  id: overrides.path,
  created: new Date(0),
  modified: new Date(0),
  messageCount: 0,
  firstMessage: "",
  allMessagesText: "",
  cwdAvailable: true,
  ...overrides,
});

const originalHideTemporary = settings.hideTemporarySessions;
afterEach(() => {
  sessions.value = [];
  settings.hideTemporarySessions = originalHideTemporary;
});

describe("session grouping helpers", () => {
  test("classifies temporary session paths", () => {
    expect(isTemporarySessionPath("/tmp/x")).toBe(true);
    expect(isTemporarySessionPath("/private/tmp/x")).toBe(true);
    expect(isTemporarySessionPath("/var/folders/ab/cd/T/x")).toBe(true);
    expect(isTemporarySessionPath("/Users/me/project")).toBe(false);
  });

  test("projectName uses the last path segment cross-platform", () => {
    expect(projectName("/Users/me/projects/pichamber/")).toBe("pichamber");
    expect(projectName("C:\\Users\\me\\pichamber")).toBe("pichamber");
    expect(projectName("/")).toBe("/");
  });

  test("sessionAge renders compact buckets", () => {
    const now = Date.now();
    expect(sessionAge(session({ path: "/a", cwd: "/p", modified: new Date(now - 3 * 60_000) }))).toBe("3m");
    expect(sessionAge(session({ path: "/a", cwd: "/p", modified: new Date(now - 5 * 3_600_000) }))).toBe("5h");
    expect(sessionAge(session({ path: "/a", cwd: "/p", modified: new Date(now - 40 * 86_400_000) }))).toBe("1mo");
  });

  test("isMissingProjectCwd is true only when every root cwd is gone", () => {
    const present = session({ path: "/a", cwd: "/p" });
    const missing = session({ path: "/b", cwd: "/p", cwdAvailable: false });
    expect(isMissingProjectCwd([])).toBe(false);
    expect(isMissingProjectCwd([{ root: present, descendants: [] }])).toBe(false);
    expect(isMissingProjectCwd([{ root: missing, descendants: [] }])).toBe(true);
  });
});

describe("useSessionGroups", () => {
  test("attributes grandchildren to the top ancestor and stops at a cwd change", () => {
    sessions.value = [
      session({ path: "/s/a", cwd: "/proj/a", modified: new Date("2026-01-01") }),
      session({ path: "/s/b", cwd: "/proj/a", parentSessionPath: "/s/a", modified: new Date("2026-01-02") }),
      session({ path: "/s/c", cwd: "/proj/a", parentSessionPath: "/s/b", modified: new Date("2026-01-03") }),
      // Cross-project fork: keeps parentSessionPath but changes cwd.
      session({ path: "/s/d", cwd: "/other", parentSessionPath: "/s/c", modified: new Date("2026-01-04") }),
    ];
    const { projectGroups } = useSessionGroups();

    expect(projectGroups.value.map((bucket) => bucket.cwd)).toEqual(["/other", "/proj/a"]);

    const other = projectGroups.value[0]!;
    expect(other.groups[0]!.root.path).toBe("/s/d");

    const projectA = projectGroups.value[1]!;
    expect(projectA.groups).toHaveLength(1);
    expect(projectA.groups[0]!.root.path).toBe("/s/a");
    // Descendants are newest-first and flattened (B is C's direct parent).
    expect(projectA.groups[0]!.descendants.map((s) => s.path)).toEqual(["/s/c", "/s/b"]);
  });

  test("groups Windows paths case-insensitively but not POSIX paths", () => {
    sessions.value = [
      session({ path: "/s/1", cwd: "C:\\Users\\Me\\Proj" }),
      session({ path: "/s/2", cwd: "c:\\users\\me\\proj" }),
      session({ path: "/s/3", cwd: "/Users/Me/Proj" }),
      session({ path: "/s/4", cwd: "/users/me/proj" }),
    ];
    const { projectGroups } = useSessionGroups();

    const windows = projectGroups.value.filter((bucket) => bucket.cwd.startsWith("C:") || bucket.cwd.startsWith("c:"));
    expect(windows).toHaveLength(1);
    expect(windows[0]!.groups).toHaveLength(2);

    const posix = projectGroups.value.filter((bucket) => bucket.cwd.startsWith("/Users") || bucket.cwd.startsWith("/users"));
    expect(posix).toHaveLength(2);
  });

  test("filters by search across title and message text", () => {
    settings.hideTemporarySessions = false;
    sessions.value = [
      session({ path: "/s/1", cwd: "/p", name: "Refactor parser", allMessagesText: "rename the lexer" }),
      session({ path: "/s/2", cwd: "/p", firstMessage: "fix sidebar", allMessagesText: "css tweak" }),
    ];
    const { sessionSearch, visibleSessions } = useSessionGroups();

    expect(visibleSessions.value).toHaveLength(2);
    sessionSearch.value = "lexer";
    expect(visibleSessions.value.map((s) => s.path)).toEqual(["/s/1"]);
    sessionSearch.value = "sidebar";
    expect(visibleSessions.value.map((s) => s.path)).toEqual(["/s/2"]);
  });

  test("paginates roots and expands collapsed descendants", () => {
    settings.hideTemporarySessions = false;
    const roots = Array.from({ length: 7 }, (_, i) =>
      session({ path: `/s/${i}`, cwd: "/proj", modified: new Date(2026, 0, i + 1) }),
    );
    const child = session({ path: "/s/child", cwd: "/proj", parentSessionPath: "/s/0", modified: new Date(2026, 1, 1) });
    sessions.value = [child, ...roots];
    const { projectGroups, visibleProjectItems, hasMoreRoots, showMoreSessions, collapsedSessions } = useSessionGroups();

    const groups = projectGroups.value[0]!.groups;
    // Newest root first: /s/6 … /s/0, so the child (newer still) is attributed to /s/0.
    expect(groups[0]!.root.path).toBe("/s/6");
    expect(groups.at(-1)!.root.path).toBe("/s/0");

    // The immediate watch collapses every parent, so descendants stay hidden.
    expect(collapsedSessions.value.has("/s/0")).toBe(true);
    expect(visibleProjectItems("/proj", groups).map((item) => item.session.path)).toEqual([
      "/s/6", "/s/5", "/s/4", "/s/3", "/s/2",
    ]);
    expect(hasMoreRoots("/proj", groups)).toBe(true);

    collapsedSessions.value = new Set();
    showMoreSessions("/proj");
    const items = visibleProjectItems("/proj", groups);
    expect(items.filter((item) => !item.isDescendant)).toHaveLength(7);
    expect(items.some((item) => item.session.path === "/s/child")).toBe(true);
    expect(hasMoreRoots("/proj", groups)).toBe(false);
  });
});
