export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}

/** Return the thinking levels a model supports, matching Pi's logic exactly. */
export function getSupportedThinkingLevels(model?: ModelInfo): ThinkingLevel[] {
  if (!model?.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  if (!map) return ALL_THINKING_LEVELS;
  return ALL_THINKING_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) return false;
    // "xhigh" and "max" are opt-in: must have an explicit mapping.
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export interface ToolActivity {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  output?: unknown;
  /** Tool-emitted error string. Surfaces above output when present so the
   *  user sees the failure even if `output` is the partial stdout. */
  error?: string;
  status: "running" | "complete" | "error";
  startedAt: number;
  /** Unix-ms wall-clock when the tool finished. Used to render the duration
   *  badge next to the tool name (OpenChamber-style). */
  endedAt?: number;
  /** Optional backend metadata — patch/diff text for edit tools, diagnostics,
   *  multi-file lists, etc. Mirrors OpenChamber's ToolPart.metadata. */
  metadata?: Record<string, unknown>;
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
  /** Whether `cwd` still exists on disk. Sessions in an unavailable group
   *  cannot be opened because Pi has no directory to run in. */
  available: boolean;
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

