const BASE = (window as unknown as Record<string, string>).__PICHAMBER_API_BASE__ || "http://localhost:1420";

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(text);
  }
  if (response.status === 204) return undefined as T;
  // Handle empty 200 responses (e.g. rpc_send, rpc_stop)
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Session types (mirrors Rust) ────────────────────────────────────

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

export interface ProjectSessions {
  cwd: string;
  name: string;
  sessions: SessionInfo[];
}

// ── File types ──────────────────────────────────────────────────────

export interface TreeEntry {
  name: string;
  path: string;
  kind: string;
  size?: number;
  children?: TreeEntry[];
}

export interface OpenFile {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

// ── RPC types ────────────────────────────────────────────────────────

export interface RpcStartResult {
  instanceId: string;
  generation: number;
  executable: string;
}

export interface RpcEventEnvelope {
  instanceId: string;
  generation: number;
  line: string;
}

export interface RpcClosedEnvelope {
  instanceId: string;
  generation: number;
  code?: number;
}

// ── Public API ──────────────────────────────────────────────────────

export async function findPi(piPath?: string): Promise<string> {
  const params = piPath ? `?path=${encodeURIComponent(piPath)}` : "";
  const data = await request<{ path: string }>("GET", `/api/pi/path${params}`);
  return data.path;
}

export async function startRpc(
  options: { cwd: string; piPath?: string; env?: Record<string, string> },
  instanceId: string,
): Promise<RpcStartResult> {
  return request<RpcStartResult>("POST", "/api/rpc/start", {
    ...options,
    instanceId,
  });
}

export async function sendRpc(command: unknown, instanceId: string): Promise<void> {
  const id = encodeURIComponent(instanceId);
  await request<void>("POST", `/api/rpc/${id}/send`, command);
}

export async function stopRpc(instanceId: string): Promise<void> {
  const id = encodeURIComponent(instanceId);
  await request<void>("POST", `/api/rpc/${id}/stop`);
}

export async function listAllSessionsGrouped(): Promise<ProjectSessions[]> {
  return request<ProjectSessions[]>("GET", "/api/sessions");
}

export async function listSessions(): Promise<SessionInfo[]> {
  return request<SessionInfo[]>("GET", "/api/sessions/flat");
}

export async function deleteSession(sessionPath: string): Promise<void> {
  await request<void>("DELETE", `/api/sessions?path=${encodeURIComponent(sessionPath)}`);
}

export async function workspaceTree(
  root: string,
  relative: string = "",
  depth: number = 4,
): Promise<TreeEntry[]> {
  const params = new URLSearchParams({ root, relative, depth: String(depth) });
  return request<TreeEntry[]>("GET", `/api/workspace/tree?${params}`);
}

export async function workspaceReadFile(
  root: string,
  relative: string,
  maxBytes: number = 2_097_152,
): Promise<OpenFile> {
  const params = new URLSearchParams({ root, relative, maxBytes: String(maxBytes) });
  return request<OpenFile>("GET", `/api/workspace/file?${params}`);
}

export async function startPty(options: {
  cwd: string;
  cols: number;
  rows: number;
}): Promise<{ ptyId: string }> {
  return request<{ ptyId: string }>("POST", "/api/pty/start", options);
}

// ── WebSocket helpers ────────────────────────────────────────────────

export function rpcEventWs(instanceId: string): WebSocket {
  const id = encodeURIComponent(instanceId);
  return new WebSocket(apiUrl(`/api/rpc/${id}/events`).replace("http://", "ws://").replace("https://", "wss://"));
}

export function ptyWs(ptyId: string): WebSocket {
  const id = encodeURIComponent(ptyId);
  return new WebSocket(apiUrl(`/api/pty/${id}`).replace("http://", "ws://").replace("https://", "wss://"));
}

// ── Project picker ───────────────────────────────────────────────────

export async function openProject(): Promise<{ id: string; name: string; path: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.onchange = () => {
      const files = input.files;
      if (files && files.length > 0) {
        // Extract root directory from first file's webkitRelativePath
        const relativePath = files[0].webkitRelativePath;
        const rootName = relativePath.split("/")[0];
        // We can approximate the path — browser can't give the full path for security
        resolve({ id: `dir:${rootName}`, name: rootName, path: `/projects/${rootName}` });
      } else {
        resolve(null);
      }
    };
    // If user cancels
    input.oncancel = () => resolve(null);
    input.click();
  });
}
