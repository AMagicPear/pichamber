export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface SessionTab {
  id: string;
  projectId: string;
  title: string;
  sessionPath?: string;
  running: boolean;
  unread: boolean;
}

export interface ModelInfo {
  provider: string;
  id: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface ToolActivity {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  output?: unknown;
  status: "running" | "complete" | "error";
  startedAt: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  tools: ToolActivity[];
  createdAt: number;
  streaming?: boolean;
  error?: string;
}

export interface UiRequest {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  children?: TreeEntry[];
}

export interface OpenFile {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface PiSessionGroup {
  cwd: string;
  name: string;
  sessions: SessionInfo[];
}

export interface SessionInfo {
  id: string;
  name?: string;
  path: string;
  cwd?: string;
  createdAt: number;
  modifiedAt: number;
  messageCount: number;
  tokens: number;
  cost: number;
}

export type RuntimeEvent = Record<string, unknown> & { type?: string };

