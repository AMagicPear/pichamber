import { computed, reactive, ref, shallowRef, watch } from "vue";
import { createSession, listSessions, toMessage } from "@/api/client";
import { pathBasename } from "@amagicpear/pichamber-shared";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentActivity,
  AgentSessionEvent,
  ImageContent,
  ModelDescriptor,
  PendingMessages,
  RuntimeResources,
  ServerMessage,
  SessionInfo,
  SessionStatsView,
  ThinkingState,
  WebExtensionUIRequest,
} from "@amagicpear/pichamber-shared";
import { settings } from "@/stores/settings";
import { applyExtensionUiRequest, pushErrorToast, resetExtensionUi } from "@/stores/extensionUi";

/** 当前工作区/会话的一切状态，按官方推荐的模块级 reactive 模式统一放这里。
 *  - `workspace`：项目/会话元数据（cwd、sessionId、sessionName…）
 *  - 其余 refs + `applyServerMessage`：会话运行时状态，由 WS 层
 *    （useConversationSession）只负责传输，本 store 按官方事件流应用状态。
 *  组件直接 import 取数。 */
export const workspace = reactive({
  cwd: "~" as string | null,
  folderName: null as string | null,
  sessionId: null as string | null,
  sessionName: "New Session" as string | null,
});

export const sessions = ref<SessionInfo[]>([]);
export const sessionsLoading = ref(false);
export const sessionsError = ref<string | null>(null);
// sessionsLoadPromise 用于防止重复加载会话列表
// 直接访问 session URL 时路由守卫和侧栏都需要会话列表，复用同一请求。
let sessionsLoadPromise: Promise<void> | null = null;

// 这个功能是传入一个会话，获取会话的标题
// 假如传入的是一个 ID，它就会先找这个会话的信息
// 如果直接传入会话的信息，就直接从里面读名称字段或者第一条消息
export const sessionTitle = (session: SessionInfo | string): string => {
  const sessionInfo =
    typeof session === "string" ? sessions.value.find(({ id }) => id === session) : session;
  const sessionId = typeof session === "string" ? session : session.id;

  return (
    sessionInfo?.name?.trim() ||
    sessionInfo?.firstMessage?.trim() ||
    (sessionInfo?.messageCount === 0 ? "New Session" : `Session ${sessionId}`)
  );
};

export const loadSessions = () => {
  if (sessionsLoadPromise) return sessionsLoadPromise;

  sessionsLoading.value = true;
  sessionsLoadPromise = (async () => {
    try {
      sessions.value = await listSessions();
      sessionsError.value = null;
    } catch (error) {
      sessionsError.value = toMessage(error);
      // 失败后清空缓存，允许后续调用重新加载
      sessionsLoadPromise = null;
    } finally {
      sessionsLoading.value = false;
    }
  })();

  return sessionsLoadPromise;
};

const syncWorkspaceMetadata = (sessionId: string): boolean => {
  const session = sessions.value.find(({ id }) => id === sessionId);
  if (!session || workspace.sessionId !== sessionId) return false;
  workspace.sessionName = sessionTitle(session);
  workspace.folderName = session.cwd ? pathBasename(session.cwd) : null;
  workspace.cwd = session.cwd || null;
  return true;
};

let sessionsRefreshPromise: Promise<void> | null = null;

/** Refresh the server snapshot without replacing the visible list with a loading state. */
export const refreshSessions = () => {
  if (sessionsRefreshPromise) return sessionsRefreshPromise;

  sessionsRefreshPromise = (async () => {
    if (sessionsLoadPromise) await sessionsLoadPromise;
    try {
      sessions.value = await listSessions();
      sessionsError.value = null;
      if (workspace.sessionId) syncWorkspaceMetadata(workspace.sessionId);
    } catch (error) {
      sessionsError.value = toMessage(error);
    }
  })().finally(() => {
    sessionsRefreshPromise = null;
  });

  return sessionsRefreshPromise;
};

export const createSessionForCwd = async (cwd: string) => {
  const { sessionId, cwd: resolvedCwd } = await createSession(cwd);
  workspace.sessionId = sessionId;
  workspace.cwd = resolvedCwd;
  workspace.folderName = pathBasename(resolvedCwd);
  workspace.sessionName = "New Session";
  return sessionId;
};

export const updateWorkspace = async (sessionId: string) => {
  // A freshly created empty session is active in memory before Pi persists it,
  // so it may not appear in listAll() yet. Its local metadata is authoritative.
  if (workspace.sessionId === sessionId && workspace.cwd !== null) return true;
  workspace.sessionId = sessionId;
  await loadSessions();
  if (workspace.sessionId !== sessionId) return false;
  if (sessionsError.value) return true;
  if (syncWorkspaceMetadata(sessionId)) return true;
  await refreshSessions();
  return sessionsError.value ? true : syncWorkspaceMetadata(sessionId);
};

// ─── 会话运行时状态 ─────────────────────────────────────────────────
// 全部与会话元数据（workspace）同属"当前会话状态"，按 Vue 官方推荐的
// 模块级 store 模式统一放这里。WS 层（useConversationSession）只负责
// 传输帧，`applyServerMessage` 在这里按官方 `AgentSessionEvent` 事件流
// 应用状态（镜像 TUI 的 handleEvent），组件直接 import 取数。

/** 输入框草稿。 */
export const draft = ref<string | undefined>();
export type DraftImage = ImageContent & { id: string; aspectRatio: number };
export const images = ref<DraftImage[]>([]);
export const connected = ref(false);

export const busy = ref(false);
export const activity = ref<AgentActivity>({ phase: "idle" });
export const pending = ref<PendingMessages>({ steering: [], followUp: [] });
export const canRestorePending = ref(true);
export const resources = ref<RuntimeResources>({
  commands: [],
  tools: [],
  extensions: [],
  diagnostics: [],
  extensionInventoryAvailable: false,
});

// extensionUi（reactive + 对话框/通知队列）已挪到 @/stores/extensionUi.ts

/** 空直到服务器在 snapshot/state 里确认可用模型。 */
export const availableModels = ref<ModelDescriptor[]>([]);
export const model = ref<ModelDescriptor | undefined>();
export const thinking = ref<ThinkingState>({ level: "off", availableLevels: ["off"] });
/** Pre-formatted Context-pane view; the server is the source of truth. */
export const stats = ref<SessionStatsView | undefined>();
/** Terminal window/tab title set by extensions via `ctx.ui.setTitle()`.
 *  This is a per-session host-window title (the pi protocol's
 *  `setTitle`), NOT the browser tab title on its own — it feeds the
 *  synthesized `document.title` below and is displayed by SessionHeader
 *  as a badge next to the session name. */
export const windowTitle = ref<string | undefined>();

// ─── 会话内容（官方 AgentMessage 模型）───────────────────────────────
// 会话视图是官方 `AgentMessage[]` 的派生显示列表：assistant 消息后跟
// toolCall 工具条目，toolResult 消息按 toolCallId 合并进对应工具条目
// （照抄 TUI `renderSessionItems` 的算法）；compaction 摘要是官方
// `role: "compactionSummary"` 消息，custom 是 `role: "custom"`。
// `streaming` 标记当前正在流式的 assistant 消息（替代旧的 live 阶段）。

export type ConversationTool = {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  /** live 阶段是 pi 的 `{content, details}` 执行封套（partialResult /
   *  result），提交后由权威 toolResult 消息（`message`）接管。 */
  result?: unknown;
  isError?: boolean;
  running: boolean;
  /** 工具开始执行的时刻（ms），客户端用它校准 timeout 倒计时。 */
  startedAt?: number;
};

export type ConversationItem =
  | { id: string; kind: "message"; message: AgentMessage; streaming: boolean }
  | { id: string; kind: "tool"; tool: ConversationTool; message?: AgentMessage };

/** 会话显示列表；shallowRef：快照整体替换、事件整条重写，避免 ref 的
 *  UnwrapRef 在递归消息上深层展开（TS2589）。 */
export const conversation = shallowRef<ConversationItem[]>([]);

/** 显示条目 id 计数器：快照重建时归零，事件流按序递增。 */
let conversationIdSeq = 0;
const nextId = (prefix: string) => `${prefix}-${++conversationIdSeq}`;

/** 从官方消息列表派生显示条目（TUI `renderSessionItems` 算法）。 */
const buildConversationItems = (messages: AgentMessage[]): ConversationItem[] => {
  const items: ConversationItem[] = [];
  const pendingTool = new Map<string, number>();
  for (const message of messages) {
    if (message.role === "assistant") {
      items.push({ id: nextId("a"), kind: "message", message, streaming: false });
      for (const part of message.content) {
        if (part.type === "toolCall") {
          items.push({
            id: `tool:${part.id}`,
            kind: "tool",
            tool: {
              toolCallId: part.id,
              toolName: part.name,
              args: part.arguments,
              running: false,
            },
          });
          pendingTool.set(part.id, items.length - 1);
        }
      }
    } else if (message.role === "toolResult") {
      const index = pendingTool.get(message.toolCallId);
      const item = index !== undefined ? items[index] : undefined;
      if (index !== undefined && item?.kind === "tool") {
        items[index] = {
          ...item,
          message,
          tool: { ...item.tool, isError: message.isError, running: false },
        };
        pendingTool.delete(message.toolCallId);
      } else {
        // 孤立 toolResult（如断链/打断）：直接生成工具条目。
        items.push({
          id: `tool:${message.toolCallId}`,
          kind: "tool",
          tool: {
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            isError: message.isError,
            running: false,
          },
          message,
        });
      }
    } else {
      items.push({ id: nextId("m"), kind: "message", message, streaming: false });
    }
  }
  return items;
};

/** 整条重写第 index 个条目（触发 shallowRef 渲染）。 */
const replaceItem = (index: number, item: ConversationItem) => {
  const next = [...conversation.value];
  next[index] = item;
  conversation.value = next;
};

/** 应用一条官方 `AgentSessionEvent`（镜像 TUI handleEvent 的消息/工具
 *  分支；busy/activity/pending 由 `state` 帧承载，这里不管）。 */
const applyEvent = (event: AgentSessionEvent) => {
  const items = conversation.value;
  switch (event.type) {
    case "message_start": {
      const { role } = event.message;
      if (role === "toolResult") break; // 结果在 message_end 合并进工具条目
      conversation.value = [
        ...items,
        {
          id: nextId(role === "assistant" ? "a" : "m"),
          kind: "message",
          message: event.message,
          streaming: role === "assistant",
        },
      ];
      break;
    }
    case "message_update": {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (
          item &&
          item.kind === "message" &&
          item.streaming &&
          item.message.role === "assistant"
        ) {
          replaceItem(i, { ...item, message: event.message });
          break;
        }
      }
      break;
    }
    case "message_end": {
      const message = event.message;
      const { role } = message;
      if (role === "toolResult") {
        const index = items.findIndex(
          (i) => i.kind === "tool" && i.tool.toolCallId === message.toolCallId,
        );
        const item = index !== -1 ? items[index] : undefined;
        if (item?.kind === "tool") {
          replaceItem(index, {
            ...item,
            message,
            tool: { ...item.tool, isError: message.isError, running: false },
          });
        }
        break;
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (
          item &&
          item.kind === "message" &&
          item.message.role === role &&
          (role !== "assistant" || item.streaming)
        ) {
          replaceItem(i, { ...item, message, streaming: false });
          break;
        }
      }
      break;
    }
    case "tool_execution_start": {
      conversation.value = [
        ...items,
        {
          id: `tool:${event.toolCallId}`,
          kind: "tool",
          tool: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            running: true,
            startedAt: Date.now(),
          },
        },
      ];
      break;
    }
    case "tool_execution_update": {
      const index = items.findIndex(
        (i) => i.kind === "tool" && i.tool.toolCallId === event.toolCallId,
      );
      const item = index !== -1 ? items[index] : undefined;
      if (item?.kind === "tool") {
        replaceItem(index, { ...item, tool: { ...item.tool, result: event.partialResult } });
      }
      break;
    }
    case "tool_execution_end": {
      const index = items.findIndex(
        (i) => i.kind === "tool" && i.tool.toolCallId === event.toolCallId,
      );
      const item = index !== -1 ? items[index] : undefined;
      if (item?.kind === "tool") {
        replaceItem(index, {
          ...item,
          tool: { ...item.tool, result: event.result, isError: event.isError, running: false },
        });
      }
      break;
    }
  }
};

export const canSend = computed(
  () => connected.value && (Boolean(draft.value?.trim()) || images.value.length > 0),
);

/** 浏览器标签页标题 = 会话名 · 扩展窗口标题 - PiChamber。高频更新的
 *  windowTitle（如 titlebar-spinner 动画）会如实反映到这里，这是宿主
 *  "窗口标题"语义在浏览器里的落点。 */
watch(
  [() => workspace.sessionName, windowTitle],
  ([sessionName, title]) => {
    document.title = `${[sessionName, title].filter(Boolean).join(" · ")} - PiChamber`;
  },
  { immediate: true },
);

// 扩展 UI 装饰（对话框队列 / toast / status / widget）已挪到 @/stores/extensionUi.ts

// ─── Turn-completion notifications ──────────────────────────────────
//
// Fired when the server broadcasts `busy: false` (agent_settled /
// compaction_end). Disconnect flips busy locally without a server frame,
// so session swaps never ping.

// Short Web Audio two-note "ding-dong". Most browsers suspend an
// AudioContext until a user gesture, so the very first settle after page
// load may stay silent — that's by design and matches every other
// browser-based agent UI.
const playCompletionChime = () => {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const schedule = (t: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
    };
    const t0 = ctx.currentTime + 0.005;
    schedule(t0, 880, 0.18);
    schedule(t0 + 0.09, 1320, 0.16);
    if (ctx.state === "suspended") void ctx.resume();
    setTimeout(() => {
      ctx.close().catch(() => undefined);
    }, 400);
  } catch {
    /* users who block audio context get nothing — totally fine */
  }
};

const fireDesktopNotification = (modelLabel: string) => {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const body = modelLabel ? `${modelLabel} finished responding.` : "Agent finished responding.";
    const notification = new Notification("Pichamber", {
      body,
      silent: true,
      tag: "pichamber-completion",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    setTimeout(() => notification.close(), 7_000);
  } catch {
    /* some browsers throw when fired too often in quick succession */
  }
};

const notifyAgentSettled = () => {
  if (settings.notifySound) playCompletionChime();
  if (settings.notifyDesktop) {
    const label = model.value?.name?.trim() || model.value?.id || model.value?.provider || "";
    fireDesktopNotification(label);
  }
};

// ─── 消息帧应用（事件驱动）──────────────────────────────────────────
// WS 层只负责把帧交给这里；本函数是客户端唯一的"官方事件处理"入口：
// snapshot 重建、event 应用官方事件、state 落服务器算好的显示状态。
// seq 间隙检测发现丢帧时调用 `resync`（由 WS 层注入）请求重同步。

/** 已应用的广播序号；发现间隙就请求 resync（快照会重置）。 */
let lastSeq = 0;
let resyncPending = false;

const requestResync = (resync: () => void) => {
  if (resyncPending) return;
  resyncPending = true;
  resync();
};

export const applyServerMessage = (message: ServerMessage, resync: () => void) => {
  switch (message.type) {
    case "snapshot": {
      resyncPending = false;
      connected.value = true;
      busy.value = message.busy;
      activity.value = message.activity;
      pending.value = message.pending;
      canRestorePending.value = message.canRestorePending;
      lastSeq = message.seq;
      conversationIdSeq = 0;
      conversation.value = buildConversationItems(message.messages);
      if ("model" in message) model.value = message.model;
      if (message.availableModels) availableModels.value = message.availableModels;
      if (message.thinking) thinking.value = message.thinking;
      if (message.stats) stats.value = message.stats;
      resources.value = message.resources;
      break;
    }
    case "event": {
      if (message.seq !== lastSeq + 1) {
        requestResync(resync);
        break;
      }
      lastSeq = message.seq;
      applyEvent(message.event);
      break;
    }
    case "state": {
      if (message.seq !== lastSeq + 1) {
        requestResync(resync);
        break;
      }
      lastSeq = message.seq;
      if (message.busy !== undefined) busy.value = message.busy;
      if (message.activity) activity.value = message.activity;
      if (message.pending) pending.value = message.pending;
      if (message.resources) resources.value = message.resources;
      if ("model" in message) model.value = message.model;
      if (message.availableModels) availableModels.value = message.availableModels;
      if (message.thinking) thinking.value = message.thinking;
      if (message.stats) stats.value = message.stats;
      // 服务器只在 agent_settled / compaction_end 广播 busy=false
      // 回合跑完刷新侧栏 + 完成通知。disconnect 的本地翻转不经过这里，不会误响。
      if (message.busy === false) {
        void refreshSessions();
        notifyAgentSettled();
      }
      break;
    }
    case "ui_request": {
      // setTitle / set_editor_text 改的是 workspace 自己拥有的 state，
      // 其余扩展 UI 装饰交给 extensionUi store。
      const req = message.request as WebExtensionUIRequest;
      if (req.method === "setTitle") {
        windowTitle.value = req.title || undefined;
      } else if (req.method === "set_editor_text") {
        draft.value = req.text;
      } else {
        applyExtensionUiRequest(req);
      }
      break;
    }
    case "draft_restore":
      draft.value = [...message.messages, draft.value?.trim()].filter(Boolean).join("\n\n");
      break;
    case "error":
      pushErrorToast(message.error);
      break;
  }
};

/** 单点重置全部会话运行时状态（断连/换会话时调用）。新加 store 字段时
 *  只改这里，不会再漏在 composable 里。 */
export const resetSessionState = () => {
  lastSeq = 0;
  resyncPending = false;
  conversationIdSeq = 0;
  connected.value = false;
  conversation.value = [];
  images.value = [];
  busy.value = false;
  activity.value = { phase: "idle" };
  pending.value = { steering: [], followUp: [] };
  canRestorePending.value = true;
  resources.value = {
    commands: [],
    tools: [],
    extensions: [],
    diagnostics: [],
    extensionInventoryAvailable: false,
  };
  resetExtensionUi();
  windowTitle.value = undefined;
  model.value = undefined;
  availableModels.value = [];
  thinking.value = { level: "off", availableLevels: ["off"] };
  stats.value = undefined;
};
