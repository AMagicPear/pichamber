import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { toMessage } from "./error";
import {
  type AgentSession,
  createAgentSession,
  getAgentDir,
  sessionEntryToContextMessages,
  type SessionInfo,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage, LiveItem } from "@pichamber/shared";

// 用于快速根据ID查找会话文件位置
const sessionFileLookup = new Map<string, string>();

// 所有活跃的会话可以并行存在
const activeSessions = new Map<string, AgentSession>();

// 通过ID查找文件位置
const getSessionFileWithId = async (id: string): Promise<string | null> => {
  let sessionFile = sessionFileLookup.get(id);
  if (!sessionFile) {
    // 找不到的情况下重新更新一次查找表再找
    await listAllSessions();
    sessionFile = sessionFileLookup.get(id);
  }
  // 确实没有的话就返回null
  if (!sessionFile) return null;
  return sessionFile;
};

// 这里每次列出所有会话以后都会更新一次查找表
export const listAllSessions = async (): Promise<SessionInfo[]> => {
  const sessions: SessionInfo[] = await SessionManager.listAll();
  sessionFileLookup.clear();
  for (const session of sessions) {
    sessionFileLookup.set(session.id, session.path);
  }
  return sessions;
};

export const getSession = async (id: string): Promise<AgentSession | null> => {
  // 先找活跃会话
  const cached = activeSessions.get(id);
  if (cached) return cached;
  // 然后找静态文件的会话
  const sessionFile = await getSessionFileWithId(id);
  if (!sessionFile) return null; // 都没有说明就是没这个id的会话
  // 找到静态的会话以后创建活跃会话对象返回出去
  const sessionManager = SessionManager.open(sessionFile);
  const { session } = await createAgentSession({
    cwd: sessionManager.getCwd(),
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
  });
  activeSessions.set(id, session);
  return session;
};

export const getSessionCwd = async (id: string): Promise<string | null> => {
  const active = activeSessions.get(id);
  if (active) return active.sessionManager.getCwd();
  const sessionFile = await getSessionFileWithId(id);
  return sessionFile ? SessionManager.open(sessionFile).getCwd() : null;
};

// Match Pi's interactive transcript: render the active context path, not its full journal.
export const getConversationEntries = (session: AgentSession) =>
  session.sessionManager.buildContextEntries();

const toolCallIdOf = (message: AgentMessage): string | undefined => {
  const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
  return typeof toolCallId === "string" ? toolCallId : undefined;
};

/**
 * 把权威条目（session manager）重建为 item 列表。已存在的 item 按消息对象
 * 身份（user/assistant）或 toolCallId（tool）匹配，从而在 compaction / 分支
 * 导航等重建场景下保持客户端 key 稳定；匹配不到的条目（重连后首次重建）
 * 铸造 e:<entryId> 作为 id。工具参数从 assistant 消息的 toolCall 部分交叉
 * 引用补齐，这样重连后工具标签仍能显示命令/文件路径。
 */
export const conversationItems = (session: AgentSession, existing: LiveItem[]): LiveItem[] => {
  const entries = getConversationEntries(session);

  // 第一遍：收集 assistant 消息里的 toolCall 参数（重建场景没有 tool_execution 事件）
  const toolCallArgs = new Map<string, unknown>();
  for (const entry of entries) {
    for (const message of sessionEntryToContextMessages(entry)) {
      if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "toolCall" &&
          typeof part.id === "string"
        ) {
          toolCallArgs.set(part.id, part.arguments);
        }
      }
    }
  }

  const byMessage = new Map<AgentMessage, LiveItem>();
  const byToolCallId = new Map<string, LiveItem>();
  const byEntryId = new Map<string, LiveItem>();
  for (const item of existing) {
    if (item.kind === "tool") byToolCallId.set(item.tool.toolCallId, item);
    else if (item.kind === "custom" && item.entryId) byEntryId.set(item.entryId, item);
    else byMessage.set(item.message, item);
  }

  const items: LiveItem[] = [];
  for (const entry of entries) {
    if (entry.type === "custom_message") {
      // 重建时 createCustomMessage 产生新对象，无法按身份匹配；有 entryId
      // 的复用现有 item（内容不可变），否则新建并记住 entryId。
      const prev = byEntryId.get(entry.id);
      if (prev) {
        items.push(prev);
      } else {
        const message = sessionEntryToContextMessages(entry)[0];
        if (message) {
          items.push({ id: `e:${entry.id}`, kind: "custom", phase: "committed", message, entryId: entry.id });
        }
      }
      continue;
    }
    for (const message of sessionEntryToContextMessages(entry)) {
      if (message.role === "toolResult") {
        const toolCallId = toolCallIdOf(message);
        const prev = toolCallId ? byToolCallId.get(toolCallId) : undefined;
        if (prev) {
          items.push({ ...prev, message, phase: "committed" });
        } else if (toolCallId) {
          const isError = (message as { isError?: unknown }).isError === true;
          const toolName = (message as { toolName?: unknown }).toolName;
          items.push({
            id: `tool:${toolCallId}`,
            kind: "tool",
            phase: "committed",
            tool: {
              toolCallId,
              toolName: typeof toolName === "string" ? toolName : "",
              args: toolCallArgs.get(toolCallId),
              isError,
              running: false,
            },
            message,
          });
        }
      } else if (message.role === "user" || message.role === "assistant") {
        const prev = byMessage.get(message);
        if (prev) items.push({ ...prev, message, phase: "committed" });
        else items.push({ id: `e:${entry.id}`, kind: message.role, phase: "committed", message });
      }
      // 其他角色（custom/compaction/branchSummary）不进会话视图。
    }
  }
  return items;
};

// 将某个会话移出活跃会话，下次就要重新加载
export const deactivateSession = async (id: string) => {
  const session = activeSessions.get(id);
  if (!session) return;
  session.dispose();
  activeSessions.delete(id);
};

/**
 * 删除会话：清理内存中的 AgentSession + 删除本地 jsonl 文件
 * 从 pi packages/coding-agent/src/modes/interactive/components/session-selector.ts 复制
 */
export const deleteSession = async (
  id: string,
): Promise<{ ok: boolean; method: "trash" | "unlink" | "inmemory"; error?: string }> => {
  const session = await getSession(id);
  if (!session) return { ok: false, method: "inmemory", error: "ID对应的会话不存在" };
  session.dispose();
  activeSessions.delete(id);
  const sessionPath = session.sessionFile;
  if (!sessionPath) {
    sessionFileLookup.delete(id);
    return { ok: true, method: "inmemory" };
  }
  // Try `trash` first (if installed)
  const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
  const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

  const getTrashErrorHint = (): string | null => {
    const parts: string[] = [];
    if (trashResult.error) {
      parts.push(trashResult.error.message);
    }
    const stderr = trashResult.stderr?.trim();
    if (stderr) {
      parts.push(stderr.split("\n")[0] ?? stderr);
    }
    if (parts.length === 0) return null;
    return `trash: ${parts.join(" · ").slice(0, 200)}`;
  };

  // If trash reports success, or the file is gone afterwards, treat it as successful
  if (trashResult.status === 0 || !existsSync(sessionPath)) {
    sessionFileLookup.delete(id);
    return { ok: true, method: "trash" };
  }

  // Fallback to permanent deletion
  try {
    await unlink(sessionPath);
    sessionFileLookup.delete(id);
    return { ok: true, method: "unlink" };
  } catch (err) {
    const unlinkError = toMessage(err);
    const trashErrorHint = getTrashErrorHint();
    const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
    return { ok: false, method: "unlink", error };
  }
};

export const createSessionWithCwd = async (cwd: string): Promise<AgentSession> => {
  const sessionManager = SessionManager.create(cwd);
  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    sessionManager: sessionManager,
  });
  activeSessions.set(session.sessionId, session);
  return session;
};
