import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, ModelInfo, OpenFile, Project, SessionTab, ThinkingLevel, ToolActivity, UiRequest } from "../runtime/types";

interface AppState {
  projects: Project[];
  sessions: SessionTab[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
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
  addUserMessage(sessionId: string, text: string): void;
  hydrateMessages(sessionId: string, messages: ChatMessage[]): void;
  reduceRuntimeEvent(sessionId: string, event: Record<string, unknown>): void;
}

const titleForProject = (projectId: string, sessions: SessionTab[]) => {
  const count = sessions.filter((session) => session.projectId === projectId).length + 1;
  return count === 1 ? "New session" : `Session ${count}`;
};

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const value = part as Record<string, unknown>;
    return value.type === "text" ? String(value.text ?? "") : "";
  }).join("");
};

export const useAppStore = create<AppState>()(persist((set, get) => ({
  projects: [], sessions: [], activeProjectId: null, activeSessionId: null,
  messages: {}, activeAssistant: {}, models: [], thinkingLevel: "medium", piPath: "", theme: "system",
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
  addUserMessage: (sessionId, text) => set((state) => ({ messages: { ...state.messages, [sessionId]: [...(state.messages[sessionId] ?? []), { id: crypto.randomUUID(), role: "user", text, tools: [], createdAt: Date.now() }] } })),
  hydrateMessages: (sessionId, hydrated) => set((state) => ({ messages: { ...state.messages, [sessionId]: hydrated } })),
  reduceRuntimeEvent: (sessionId, event) => set((state) => {
    const messages = [...(state.messages[sessionId] ?? [])];
    const activeMap = { ...state.activeAssistant };
    const type = String(event.type ?? "");
    let runtimeError = state.runtimeError;
    let uiRequest = state.uiRequest;
    if (type === "message_start") {
      const raw = (event.message ?? {}) as Record<string, unknown>;
      if (raw.role === "assistant") {
        const id = String(raw.id ?? crypto.randomUUID());
        activeMap[sessionId] = id;
        messages.push({ id, role: "assistant", text: textFromContent(raw.content), tools: [], createdAt: Date.now(), streaming: true });
      }
    } else if (type === "message_update") {
      const id = activeMap[sessionId];
      const target = messages.find((message) => message.id === id);
      const update = (event.assistantMessageEvent ?? {}) as Record<string, unknown>;
      if (target && update.type === "text_delta") target.text += String(update.delta ?? "");
      if (target && ["thinking_delta", "reasoning_delta"].includes(String(update.type))) target.thinking = (target.thinking ?? "") + String(update.delta ?? "");
      if (target && update.type === "error") target.error = String(update.error ?? update.delta ?? "Response failed");
    } else if (type === "tool_execution_start") {
      let id = activeMap[sessionId];
      if (!id) {
        id = crypto.randomUUID(); activeMap[sessionId] = id;
        messages.push({ id, role: "assistant", text: "", tools: [], createdAt: Date.now(), streaming: true });
      }
      const target = messages.find((message) => message.id === id);
      const callId = String(event.toolCallId ?? crypto.randomUUID());
      const tool: ToolActivity = { id: callId, name: String(event.toolName ?? event.name ?? "Tool"), input: (event.args ?? event.input) as Record<string, unknown> | undefined, status: "running", startedAt: Date.now() };
      target?.tools.push(tool);
    } else if (["tool_execution_update", "tool_execution_end"].includes(type)) {
      const target = messages.find((message) => message.id === activeMap[sessionId]);
      const tool = target?.tools.find((value) => value.id === String(event.toolCallId));
      if (tool) { tool.output = event.result ?? event.partialResult; tool.status = event.isError ? "error" : type === "tool_execution_end" ? "complete" : "running"; }
    } else if (["message_end", "turn_end", "agent_end"].includes(type)) {
      const target = messages.find((message) => message.id === activeMap[sessionId]);
      if (target) target.streaming = false;
      if (type !== "agent_end") delete activeMap[sessionId];
    } else if (type === "extension_ui_request") {
      const method = String(event.method);
      if (["select", "confirm", "input", "editor"].includes(method)) uiRequest = event as unknown as UiRequest;
    } else if (["error", "extension_error", "rpc_disconnected"].includes(type)) {
      runtimeError = String(event.error ?? event.errorMessage ?? "Pi runtime disconnected");
    }
    return { messages: { ...state.messages, [sessionId]: messages }, activeAssistant: activeMap, runtimeError, uiRequest };
  }),
}), {
  name: "pichamber-shell-v1",
  partialize: (state) => ({ projects: state.projects, sessions: state.sessions.map((session) => ({ ...session, running: false })), activeProjectId: state.activeProjectId, activeSessionId: state.activeSessionId, theme: state.theme, thinkingLevel: state.thinkingLevel, piPath: state.piPath, sidebarOpen: state.sidebarOpen }),
}));

