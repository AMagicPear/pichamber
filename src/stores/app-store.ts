import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionView } from "../runtime/events";
import type {
  Model,
  OpenFile,
  PiSessionGroup,
  Project,
  RpcExtensionUIRequest,
  SessionTab,
  ThinkingLevel,
} from "../runtime/types";
import { initialView } from "../runtime/events";

// ─────────────────────────────────────────────────────────────────────────────
// pichamber's store: UI preferences (persisted) + session view (transient).
// Pi owns all domain state; pichamber mirrors it in `view` by folding events.
// ─────────────────────────────────────────────────────────────────────────────

interface AppState {
  // Sidebar data — fetched from the server on demand, not persisted.
  sessionGroups: PiSessionGroup[];
  sessionLoading: boolean;

  // Currently focused session. Pichamber only keeps one session's messages
  // in memory; switching sessions refetches via `get_messages`.
  sessions: SessionTab[];
  activeSessionId: string | null;
  activeProjectId: string | null;
  projects: Project[];

  // Live view of the active session — THE single source of truth.
  // Inlines RpcSessionState (thinkingLevel, model, isStreaming, etc.)
  // plus messages, runningTools, uiRequest, error.
  view: SessionView;

  // Available models, fetched once at app startup.
  models: Model[];
  // Whether the initial model bootstrap failed.
  modelsError?: string;

  // Current UI request from Pi, if any.
  uiRequest?: RpcExtensionUIRequest;

  // File viewer.
  openFile?: OpenFile;

  // Last error.
  error?: string;

  // Configuration.
  piPath: string;
  theme: "light" | "dark" | "system";
  sidebarOpen: boolean;
  sidebarWidth: number;
  inspectorOpen: boolean;
  inspectorWidth: number;
  terminalOpen: boolean;

  // Actions — kept small, one per concern.
  setSessionGroups(groups: PiSessionGroup[]): void;
  setSessionLoading(loading: boolean): void;
  setActiveSession(id: string): void;
  closeSession(id: string): void;
  upsertSession(tab: SessionTab): void;
  setProjects(projects: Project[]): void;
  /** Merge Pi state fields into the live view.state. Used after get_state RPC. */
  mergeViewState(patch: Partial<SessionView["state"]>): void;
  setView(view: SessionView | ((prev: SessionView) => SessionView)): void;
  setModels(models: Model[]): void;
  setModelsError(error: string): void;
  setUiRequest(req?: RpcExtensionUIRequest): void;
  setOpenFile(file?: OpenFile): void;
  setError(error?: string): void;
  setPiPath(path: string): void;
  setTheme(theme: "light" | "dark" | "system"): void;
  setThinkingLevel(level: ThinkingLevel): void;
  setSelectedModel(model: Model): void;
  toggleSidebar(): void;
  setSidebarWidth(width: number): void;
  toggleInspector(): void;
  setInspectorWidth(width: number): void;
  toggleTerminal(): void;
  /** Clean up stale session tabs after zustand rehydration. */
  cleanupStaleSessions(): void;
}

const initialState: Omit<AppState,
  | "setSessionGroups" | "setSessionLoading" | "setActiveSession" | "closeSession"
  | "upsertSession" | "setProjects" | "mergeViewState" | "setView" | "setModels" | "setModelsError" | "setUiRequest"
  | "setOpenFile" | "setError" | "setPiPath" | "setTheme" | "setThinkingLevel"
  | "setSelectedModel" | "toggleSidebar" | "setSidebarWidth" | "toggleInspector"
  | "setInspectorWidth" | "toggleTerminal" | "cleanupStaleSessions"
> = {
  sessionGroups: [],
  sessionLoading: false,
  sessions: [],
  activeSessionId: null,
  activeProjectId: null,
  projects: [],
  view: initialView(),
  models: [],
  piPath: "",
  theme: "system",
  sidebarOpen: true,
  sidebarWidth: 280,
  inspectorOpen: false,
  inspectorWidth: 420,
  terminalOpen: false,
};

export const useAppStore = create<AppState>()(persist((set) => ({
  ...initialState,

  setSessionGroups: (sessionGroups) => set({ sessionGroups }),
  setSessionLoading: (sessionLoading) => set({ sessionLoading }),
  setActiveSession: (id) => set((state) => ({
    activeSessionId: id,
    activeProjectId: state.sessions.find((s) => s.id === id)?.projectId ?? state.activeProjectId,
    sessions: state.sessions.map((s) => (s.id === id ? { ...s, unread: false } : s)),
  })),
  closeSession: (id) => set((state) => {
    const sessions = state.sessions.filter((s) => s.id !== id);
    return { sessions, activeSessionId: state.activeSessionId === id ? sessions.at(-1)?.id ?? null : state.activeSessionId };
  }),
  upsertSession: (tab) => set((state) => {
    const existing = state.sessions.findIndex((s) => s.id === tab.id);
    const sessions = existing === -1 ? [...state.sessions, tab] : state.sessions.map((s, i) => (i === existing ? tab : s));
    return { sessions, activeSessionId: tab.id, activeProjectId: tab.projectId };
  }),
  setProjects: (projects) => set({ projects, activeProjectId: projects[0]?.id ?? null }),
  mergeViewState: (patch) => set((prev) => ({
    view: { ...prev.view, state: { ...prev.view.state, ...patch } },
  })),
  setView: (view) => set((state) => ({ view: typeof view === "function" ? view(state.view) : view })),
  setModels: (models) => set({ models, modelsError: undefined }),
  setModelsError: (modelsError) => set({ modelsError }),
  setUiRequest: (uiRequest) => set({ uiRequest }),
  setOpenFile: (openFile) => set({ openFile, inspectorOpen: Boolean(openFile) }),
  setError: (error) => set({ error }),
  setPiPath: (piPath) => set({ piPath }),
  setTheme: (theme) => set({ theme }),
  setThinkingLevel: (thinkingLevel) => set((state) => ({
    view: { ...state.view, state: { ...state.view.state, thinkingLevel } },
  })),
  setSelectedModel: (model) => set((state) => ({
    view: { ...state.view, state: { ...state.view.state, model } },
  })),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  cleanupStaleSessions: () => set((state) => {
    // Remove synthetic "pi:new:..." tabs that never got a real sessionPath.
    const valid = state.sessions.filter(
      (s) => !s.id.startsWith("pi:new:") || s.sessionPath,
    );
    if (valid.length === state.sessions.length) return {};
    const activeStillValid = valid.some((s) => s.id === state.activeSessionId);
    return {
      sessions: valid,
      activeSessionId: activeStillValid ? state.activeSessionId : valid.at(-1)?.id ?? null,
    };
  }),
}), {
  name: "pichamber-shell-v3",
  partialize: (state) => ({
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    activeProjectId: state.activeProjectId,
    theme: state.theme,
    piPath: state.piPath,
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    inspectorWidth: state.inspectorWidth,
  }),
}));
