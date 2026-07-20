import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionView } from "../runtime/events";
import type {
  Model,
  OpenFile,
  PiSessionGroup,
  Project,
  RpcExtensionUIRequest,
  RpcSessionState,
  SessionTab,
  ThinkingLevel,
} from "../runtime/types";
import { initialView } from "../runtime/events";

// ─────────────────────────────────────────────────────────────────────────────
// pichamber's only persistent state is UI preferences and the active session
// pointer. Everything else (messages, models, thinking level, running tools)
// is owned by Pi and mirrored from events through `use-pichamber`.
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

  // Mirror of Pi's `get_state` response.
  state: RpcSessionState;

  // Live view of the active session — built by folding Pi events.
  view: SessionView;

  // Available models, fetched once from Pi.
  models: Model[];

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
  setState(state: RpcSessionState): void;
  setView(view: SessionView | ((prev: SessionView) => SessionView)): void;
  setModels(models: Model[]): void;
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
}

const initialState: Omit<AppState,
  | "setSessionGroups" | "setSessionLoading" | "setActiveSession" | "closeSession"
  | "upsertSession" | "setProjects" | "setState" | "setView" | "setModels" | "setUiRequest"
  | "setOpenFile" | "setError" | "setPiPath" | "setTheme" | "setThinkingLevel"
  | "setSelectedModel" | "toggleSidebar" | "setSidebarWidth" | "toggleInspector"
  | "setInspectorWidth" | "toggleTerminal"
> = {
  sessionGroups: [],
  sessionLoading: false,
  sessions: [],
  activeSessionId: null,
  activeProjectId: null,
  projects: [],
  state: {
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    sessionId: "",
    autoCompactionEnabled: true,
    messageCount: 0,
    pendingMessageCount: 0,
  },
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
  setState: (state) => set({ state }),
  setView: (view) => set((state) => ({ view: typeof view === "function" ? view(state.view) : view })),
  setModels: (models) => set({ models }),
  setUiRequest: (uiRequest) => set({ uiRequest }),
  setOpenFile: (openFile) => set({ openFile, inspectorOpen: Boolean(openFile) }),
  setError: (error) => set({ error }),
  setPiPath: (piPath) => set({ piPath }),
  setTheme: (theme) => set({ theme }),
  setThinkingLevel: (thinkingLevel) => set((state) => ({ state: { ...state.state, thinkingLevel } })),
  setSelectedModel: (model) => set((state) => ({ state: { ...state.state, model } })),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
}), {
  name: "pichamber-shell-v2",
  partialize: (state) => ({
    activeSessionId: state.activeSessionId,
    activeProjectId: state.activeProjectId,
    theme: state.theme,
    piPath: state.piPath,
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
    inspectorWidth: state.inspectorWidth,
  }),
}));
