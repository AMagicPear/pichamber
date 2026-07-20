import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store";

describe("app-store", () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: [],
      view: undefined as never,
      error: undefined,
      uiRequest: undefined,
    });
  });

  it("upserts a session and marks it active", () => {
    useAppStore.getState().upsertSession({
      id: "pi:abc", projectId: "/p", title: "T", sessionPath: "/p/a.jsonl", running: false, unread: false,
    });
    const s = useAppStore.getState();
    expect(s.sessions).toHaveLength(1);
    expect(s.activeSessionId).toBe("pi:abc");
    expect(s.activeProjectId).toBe("/p");
  });

  it("renames a session via upsertSession", () => {
    useAppStore.getState().upsertSession({ id: "pi:abc", projectId: "/p", title: "Old", running: false, unread: false });
    const tab = useAppStore.getState().sessions[0];
    useAppStore.getState().upsertSession({ ...tab, title: "New" });
    expect(useAppStore.getState().sessions[0].title).toBe("New");
  });

  it("closes the active session and falls back to the last remaining one", () => {
    const a = { id: "pi:a", projectId: "/p", title: "A", running: false, unread: false } as const;
    const b = { id: "pi:b", projectId: "/p", title: "B", running: false, unread: false } as const;
    useAppStore.getState().upsertSession(a);
    useAppStore.getState().upsertSession(b);
    useAppStore.getState().closeSession("pi:b");
    expect(useAppStore.getState().activeSessionId).toBe("pi:a");
  });

  it("sets and clears errors", () => {
    useAppStore.getState().setError("boom");
    expect(useAppStore.getState().error).toBe("boom");
    useAppStore.getState().setError(undefined);
    expect(useAppStore.getState().error).toBeUndefined();
  });
});
