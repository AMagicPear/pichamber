import type { OpenFile, PiSessionGroup, TreeEntry } from "../runtime/types";

const BASE = (window as unknown as Record<string, string | undefined>).__PICHAMBER_API_BASE__ ?? "http://localhost:1420";

function apiUrl(path: string): string {
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
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export interface RpcStartResult {
  instanceId: string;
  generation: number;
  executable: string;
}

// ── Pi RPC ──────────────────────────────────────────────────────────

export async function findPi(piPath?: string): Promise<string> {
  const params = piPath ? `?path=${encodeURIComponent(piPath)}` : "";
  const data = await request<{ path: string }>("GET", `/api/pi/path${params}`);
  return data.path;
}

export async function startRpc(
  options: { cwd: string; piPath?: string; env?: Record<string, string> },
  instanceId: string,
): Promise<RpcStartResult> {
  return request<RpcStartResult>("POST", "/api/rpc/start", { ...options, instanceId });
}

export async function sendRpc(command: unknown, instanceId: string): Promise<void> {
  await request<void>("POST", `/api/rpc/${encodeURIComponent(instanceId)}/send`, command);
}

export async function stopRpc(instanceId: string): Promise<void> {
  await request<void>("POST", `/api/rpc/${encodeURIComponent(instanceId)}/stop`);
}

// ── Sessions ────────────────────────────────────────────────────────

export async function listAllSessionsGrouped(): Promise<PiSessionGroup[]> {
  return request<PiSessionGroup[]>("GET", "/api/sessions");
}

export async function deleteSession(sessionPath: string): Promise<void> {
  await request<void>("DELETE", `/api/sessions?path=${encodeURIComponent(sessionPath)}`);
}

export async function createSession(cwd: string): Promise<{ dir: string }> {
  return request<{ dir: string }>("GET", `/api/sessions/new?cwd=${encodeURIComponent(cwd)}`);
}

// ── Workspace files ─────────────────────────────────────────────────

export async function workspaceTree(root: string, relative = "", depth = 4): Promise<TreeEntry[]> {
  const params = new URLSearchParams({ root, relative, depth: String(depth) });
  return request<TreeEntry[]>("GET", `/api/workspace/tree?${params}`);
}

export async function workspaceReadFile(root: string, relative: string, maxBytes = 2_097_152): Promise<OpenFile> {
  const params = new URLSearchParams({ root, relative, maxBytes: String(maxBytes) });
  return request<OpenFile>("GET", `/api/workspace/file?${params}`);
}

// ── Terminal (PTY) ──────────────────────────────────────────────────

export async function startPty(options: { cwd: string; cols: number; rows: number }): Promise<{ ptyId: string }> {
  return request<{ ptyId: string }>("POST", "/api/pty/start", options);
}

// ── Native dialogs ───────────────────────────────────────────────────

export async function selectDirectory(): Promise<string | null> {
  try {
    const data = await request<{ path: string }>("POST", "/api/dialog/select-directory");
    return data.path;
  } catch {
    return null;
  }
}

// ── WebSocket helpers ───────────────────────────────────────────────

function wsUrl(path: string): string {
  return apiUrl(path).replace(/^http/, "ws");
}

export function rpcEventWs(instanceId: string): WebSocket {
  return new WebSocket(wsUrl(`/api/rpc/${encodeURIComponent(instanceId)}/events`));
}

export function ptyWs(ptyId: string): WebSocket {
  return new WebSocket(wsUrl(`/api/pty/${encodeURIComponent(ptyId)}`));
}
