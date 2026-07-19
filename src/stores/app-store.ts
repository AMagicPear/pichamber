import { create } from "zustand";
import { persist } from "zustand/middleware";
import { reduceRuntimeEvent } from "../runtime/normalize-events";
import type { ChatMessage, ModelInfo, OpenFile, Project, SessionInfo, SessionTab, ThinkingLevel, UiRequest } from "../runtime/types";

interface AppState {
  projects: Project[];
  sessions: SessionTab[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  attachments: Record<string, string[]>;
  activeAssistant: Record<string, string | undefined>;
  models: ModelInfo[];
  selectedModel?: ModelInfo;
  thinkingLevel: ThinkingLevel;
  piPath: string;
  theme: "light" | "dark" | "system";
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  terminalOpen: boolean;
  openFile?: OpenFile;
  uiRequest?: UiRequest;
  runtimeError?: string;
  addProject(project: Project): void;
  removeProject(id: string): void;
  addSession(projectId: string): SessionTab;
  resumeSession(projectId: string, path: string, title: string): SessionTab;
  discoverPiSessions(projectId: string, candidates: SessionInfo[]): SessionTab[];
  openPiSession(key: string, cwd: string, title: string, sessionPath?: string): void;
  setActiveSession(id: string): void;
  closeSession(id: string): void;
  renameSession(id: string, title: string): void;
  setSessionRunning(id: string, running: boolean): void;
  setModels(models: ModelInfo[]): void;
  setSelectedModel(model: ModelInfo): void;
  setThinkingLevel(level: ThinkingLevel): void;
  setPiPath(path: string): void;
  setTheme(theme: "light" | "dark" | "system"): void;
  toggleSidebar(): void;
  toggleInspector(): void;
  toggleTerminal(): void;
  setOpenFile(file?: OpenFile): void;
  setUiRequest(request?: UiRequest): void;
  setRuntimeError(error?: string): void;
  addUserMessage(sessionId: string, text: string, attachments?: string[]): void;
  hydrateMessages(sessionId: string, messages: ChatMessage[]): void;
  addAttachment(sessionId: string, path: string): void;
  removeAttachment(sessionId: string, path: string): void;
  removeAllAttachments(sessionId: string): void;
  reduceRuntimeEvent(sessionId: string, event: Record<string, unknown>): void;
}

const titleForProject = (projectId: string, sessions: SessionTab[]) => {
  const count = sessions.filter((session) => session.projectId === projectId).length + 1;
  return count === 1 ? "New session" : `Session ${count}`;
};

export const useAppStore = create<AppState>()(persist((set, get) => ({
  projects: [], sessions: [], activeProjectId: null, activeSessionId: null,
  messages: {}, attachments: {}, activeAssistant: {}, models: [], thinkingLevel: "medium", piPath: "", theme: "system",
  sidebarOpen: true, inspectorOpen: false, terminalOpen: false,
  addProject: (project) => set((state) => {
    const existing = state.projects.find((value) => value.path === project.path);
    const target = existing ?? project;
    return { projects: existing ? state.projects : [...state.projects, project], activeProjectId: target.id };
  }),
  removeProject: (id) => set((state) => {
    const projects = state.projects.filter((project) => project.id !== id);
    const removedSessions = new Set(state.sessions.filter((session) => session.projectId === id).map((session) => session.id));
    const sessions = state.sessions.filter((session) => session.projectId !== id);
    const messages = Object.fromEntries(Object.entries(state.messages).filter(([sessionId]) => !removedSessions.has(sessionId)));
    return { projects, sessions, messages, activeProjectId: state.activeProjectId === id ? projects[0]?.id ?? null : state.activeProjectId, activeSessionId: removedSessions.has(state.activeSessionId ?? "") ? sessions[0]?.id ?? null : state.activeSessionId };
  }),
  addSession: (projectId) => {
    const state = get();
    const session: SessionTab = { id: crypto.randomUUID(), projectId, title: titleForProject(projectId, state.sessions), running: false, unread: false };
    set({ sessions: [...state.sessions, session], activeSessionId: session.id, activeProjectId: projectId, messages: { ...state.messages, [session.id]: [] } });
    return session;
  },
  resumeSession: (projectId, path, title) => {
    const existing = get().sessions.find((session) => session.sessionPath === path);
    if (existing) { get().setActiveSession(existing.id); return existing; }
    const session: SessionTab = { id: crypto.randomUUID(), projectId, title, sessionPath: path, running: false, unread: false };
    set((state) => ({ sessions: [...state.sessions, session], activeSessionId: session.id, activeProjectId: projectId, messages: { ...state.messages, [session.id]: [] } }));
    return session;
  },
  discoverPiSessions: (projectId, candidates) => {
    const state = get();
    const knownPaths = new Set(state.sessions.filter((session) => session.sessionPath).map((session) => session.sessionPath as string));
    const newSessions: SessionTab[] = [];
    let messageSlots = { ...state.messages };
    for (const candidate of candidates) {
      if (!candidate.path || knownPaths.has(candidate.path)) continue;
      const session: SessionTab = {
        id: crypto.randomUUID(),
        projectId,
        title: candidate.name || candidate.path.split(/[/\\]/).pop() || "Pi session",
        sessionPath: candidate.path,
        running: false,
        unread: false,
      };
      newSessions.push(session);
      knownPaths.add(candidate.path);
      messageSlots = { ...messageSlots, [session.id]: [] };
    }
    if (newSessions.length === 0) return [];
    set({ sessions: [...state.sessions, ...newSessions], messages: messageSlots });
    return newSessions;
  },
  openPiSession: (key, cwd, title, sessionPath) => {
    const existing = get().sessions.find((session) => session.id === key);
    if (existing) {
      set({ activeSessionId: key, activeProjectId: cwd });
      return;
    }
    const session: SessionTab = {
      id: key,
      projectId: cwd,        // we store cwd in projectId for Pi sessions
      title,
      sessionPath,
      running: false,
      unread: false,
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: key,
      activeProjectId: cwd,
      messages: { ...state.messages, [key]: [] },
    }));
  },
  setActiveSession: (id) => set((state) => ({ activeSessionId: id, activeProjectId: state.sessions.find((session) => session.id === id)?.projectId ?? state.activeProjectId, sessions: state.sessions.map((session) => session.id === id ? { ...session, unread: false } : session) })),
  closeSession: (id) => set((state) => {
    const sessions = state.sessions.filter((session) => session.id !== id);
    return { sessions, activeSessionId: state.activeSessionId === id ? sessions.at(-1)?.id ?? null : state.activeSessionId };
  }),
  renameSession: (id, title) => set((state) => ({ sessions: state.sessions.map((session) => session.id === id ? { ...session, title } : session) })),
  setSessionRunning: (id, running) => set((state) => ({ sessions: state.sessions.map((session) => session.id === id ? { ...session, running } : session) })),
  setModels: (models) => set({ models, selectedModel: get().selectedModel ?? models[0] }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
  setPiPath: (piPath) => set({ piPath }),
  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
  setOpenFile: (openFile) => set({ openFile, inspectorOpen: Boolean(openFile) }),
  setUiRequest: (uiRequest) => set({ uiRequest }),
  setRuntimeError: (runtimeError) => set({ runtimeError }),
  addUserMessage: (sessionId, text, attachments) => set((state) => ({ messages: { ...state.messages, [sessionId]: [...(state.messages[sessionId] ?? []), { id: crypto.randomUUID(), role: "user", text, tools: [], createdAt: Date.now() }] }, attachments: attachments ? { ...state.attachments, [sessionId]: attachments } : state.attachments })),
  addAttachment: (sessionId, path) => set((state) => ({ attachments: { ...state.attachments, [sessionId]: [...(state.attachments[sessionId] ?? []).filter((value) => value !== path), path] } })),
  removeAttachment: (sessionId, path) => set((state) => ({ attachments: { ...state.attachments, [sessionId]: (state.attachments[sessionId] ?? []).filter((value) => value !== path) } })),
  removeAllAttachments: (sessionId) => set((state) => ({ attachments: { ...state.attachments, [sessionId]: [] } })),
  hydrateMessages: (sessionId, hydrated) => set((state) => ({ messages: { ...state.messages, [sessionId]: hydrated } })),
  reduceRuntimeEvent: (sessionId, event) => set((state) => {
    const slice = reduceRuntimeEvent(sessionId, state.messages[sessionId] ?? [], state.activeAssistant, event);
    return {
      messages: { ...state.messages, [sessionId]: slice.messages },
      activeAssistant: slice.activeAssistant,
      runtimeError: slice.runtimeError ?? state.runtimeError,
      uiRequest: slice.uiRequest ?? state.uiRequest,
    };
  }),
}), {
  name: "pichamber-shell-v1",
  partialize: (state) => ({ projects: state.projects, sessions: state.sessions.map((session) => ({ ...session, running: false })), activeProjectId: state.activeProjectId, activeSessionId: state.activeSessionId, theme: state.theme, thinkingLevel: state.thinkingLevel, piPath: state.piPath, sidebarOpen: state.sidebarOpen }),
}));