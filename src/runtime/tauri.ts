import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { OpenFile, PiSessionGroup, Project, SessionInfo, TreeEntry } from "./types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

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

export async function openProject(): Promise<Project | null> {
  if (!isTauri()) {
    return { id: "demo", name: "pichamber-demo", path: "/workspace/pichamber-demo" };
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title: "Open project" });
  if (!selected) return null;
  const path = String(selected);
  return { id: crypto.randomUUID(), name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, path };
}

export const native = {
  findPi: (piPath?: string) => invoke<string>("find_pi", { piPath }),
  startRpc: (options: { cwd: string; piPath?: string; env?: Record<string, string> }, instanceId: string) =>
    invoke<{ instanceId: string; generation: number; executable: string }>("rpc_start", { options, instanceId }),
  sendRpc: (command: unknown, instanceId: string) => invoke<void>("rpc_send", { command: JSON.stringify(command), instanceId }),
  stopRpc: (instanceId: string) => invoke<void>("rpc_stop", { instanceId }),
  listAllSessionsGrouped: () => invoke<PiSessionGroup[]>("list_all_sessions_grouped"),
  listSessions: () => invoke<SessionInfo[]>("list_sessions"),
  deleteSession: (sessionPath: string) => invoke<void>("delete_session", { sessionPath }),
  tree: (root: string, relative: string = "", depth: number = 4) =>
    invoke<TreeEntry[]>("workspace_tree", { root, relative, depth }),
  readFile: (root: string, relative: string) => invoke<OpenFile>("workspace_read_file", { root, relative, maxBytes: 2_097_152 }),
  startPty: (cwd: string, cols: number, rows: number) => invoke<{ ptyId: string }>("pty_start", { options: { cwd, cols, rows } }),
  writePty: (ptyId: string, data: string) => invoke<void>("pty_write", { ptyId, data }),
  resizePty: (ptyId: string, cols: number, rows: number) => invoke<void>("pty_resize", { ptyId, cols, rows }),
  stopPty: (ptyId: string) => invoke<void>("pty_stop", { ptyId }),
  listenRpc: async (
    onEvent: (payload: RpcEventEnvelope) => void,
    onClosed: (payload: RpcClosedEnvelope) => void,
    onStderr: (payload: RpcEventEnvelope) => void,
  ): Promise<UnlistenFn[]> => [
    await listen<RpcEventEnvelope>("rpc-event", (event) => onEvent(event.payload)),
    await listen<RpcClosedEnvelope>("rpc-closed", (event) => onClosed(event.payload)),
    await listen<RpcEventEnvelope>("rpc-stderr", (event) => onStderr(event.payload)),
  ],
};

