import { computed, ref, shallowRef } from "vue";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentActivity,
  AgentSessionEvent,
  JsonAgentSessionEvent,
  ImageContent,
  ModelDescriptor,
  PendingMessages,
  RuntimeResources,
  RuntimeSlashCommand,
  ServerMessage,
  SessionStatsView,
  ThinkingState,
} from "@amagicpear/pichamber-shared";
import { BUILTIN_COMMANDS } from "@/composables/builtin-commands";
import { applyExtensionUiRequest, resetExtensionUi } from "@/stores/extensionUi";
import type { SessionEffect } from "@/stores/sessionEffects";

/** 当前会话的运行时投影。它不保存原始 WebSocket 帧；每个字段都是组件可
 * 直接读取的当前事实。传输、协议归约和浏览器副作用分别在其相邻模块负责。 */

/** 输入框草稿。 */
export const draft = ref<string | undefined>();
export type DraftImage = ImageContent & { id: string; aspectRatio: number };
export const images = ref<DraftImage[]>([]);
export const connected = ref(false);

/** 是否在工作 = activity 不是 idle。服务端不单独发 busy 了：agent_start /
 *  compaction_start / auto_retry_start → 非 idle，settlement → idle，
 *  与旧 busy 完全等价（agent loop 恒先发 agent_start 再发 user/assistant
 *  message_start，所以没有需要防御翻转的窗口）。 */
export const working = computed(() => activity.value.phase !== "idle");

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

/** 命令选择器 shelf 的完整列表：前端内置命令 + 服务端下发的扩展/prompt/
 *  skill 命令。builtin 定义在 `@/composables/builtin-commands`，服务端不再
 * 下发它们。 */
export const shelfCommands = computed<RuntimeSlashCommand[]>(() => [
  ...BUILTIN_COMMANDS,
  ...resources.value.commands,
]);

/** 空直到服务器在 snapshot/state 里确认可用模型。 */
export const availableModels = ref<ModelDescriptor[]>([]);
export const model = ref<ModelDescriptor | undefined>();
export const thinking = ref<ThinkingState>({ level: "off", availableLevels: ["off"] });
/** Pre-formatted Context-pane view; the server is the source of truth. */
export const stats = ref<SessionStatsView | undefined>();
/** 最后一条 assistant 消息实际使用的模型 ID。某些 provider（如火山方舟
 *  Agent Plan）会把响应里回显的规范化模型 ID（deepseek-v4-flash-ga-260731）
 *  写进 assistant 消息，而 `model`/`stats.model` 仍是用户选中的别名；
 *  Context 面板用它展示 provider 实际调度到的模型。 */
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
  | { id: string; kind: "message"; message: AgentMessage; entryId?: string; streaming: boolean }
  | { id: string; kind: "tool"; tool: ConversationTool; message?: AgentMessage };

/** 会话显示列表；shallowRef：快照整体替换、事件整条重写，避免 ref 的
 *  UnwrapRef 在递归消息上深层展开（TS2589）。 */
export const conversation = shallowRef<ConversationItem[]>([]);

/** The actual provider model is durable message data, not a second mutable
 * store field. Snapshot rebuilds and incremental events therefore stay in sync
 * without special reset or reconciliation branches. */
export const lastAssistantModel = computed(() => {
  for (let index = conversation.value.length - 1; index >= 0; index -= 1) {
    const item = conversation.value[index];
    if (item?.kind === "message" && item.message.role === "assistant" && item.message.model) return item.message.model;
  }
  return undefined;
});

/** 显示条目 id 计数器：快照重建时归零，事件流按序递增。 */
let conversationIdSeq = 0;
const nextId = (prefix: string) => `${prefix}-${++conversationIdSeq}`;

/** 从官方消息列表派生显示条目（TUI `renderSessionItems` 算法）。 */
const buildConversationItems = (
  messages: AgentMessage[],
  messageEntryIds: Array<string | undefined> = [],
): ConversationItem[] => {
  const items: ConversationItem[] = [];
  const pendingTool = new Map<string, number>();
  for (const [messageIndex, message] of messages.entries()) {
    const entryId = messageEntryIds[messageIndex];
    if (message.role === "assistant") {
      items.push({ id: nextId("a"), kind: "message", message, entryId, streaming: false });
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
      items.push({ id: nextId("m"), kind: "message", message, entryId, streaming: false });
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
 *  分支）。activity / pending / thinking 直接由官方事件派生——不再有服务端
 *  二次编码的 `state.activity`/`state.pending` 平行词汇。compaction 失败
 *  提示在这里弹（事件本身带 errorMessage，不需要服务端伪造 notify 帧）。 */
const applyEvent = (event: AgentSessionEvent | JsonAgentSessionEvent): SessionEffect[] => {
  const items = conversation.value;
  const effects: SessionEffect[] = [];
  switch (event.type) {
    case "agent_start":
      activity.value = { phase: "working" };
      break;
    case "agent_settled": {
      const effect = advanceActivity({ phase: "idle" });
      if (effect) effects.push(effect);
      break;
    }
    case "compaction_start":
      activity.value = { phase: "compacting" };
      break;
    case "compaction_end": {
      const effect = advanceActivity({ phase: "idle" });
      if (effect) effects.push(effect);
      if (typeof event.errorMessage === "string" && event.errorMessage) {
        effects.push({ type: "error", message: event.errorMessage.replace(/^Compaction failed: /, "") });
      }
      break;
    }
    case "auto_retry_start":
      activity.value = { phase: "retrying", attempt: event.attempt, maxAttempts: event.maxAttempts };
      break;
    case "queue_update":
      pending.value = { steering: [...event.steering], followUp: [...event.followUp] };
      break;
    case "thinking_level_changed":
      thinking.value = { ...thinking.value, level: event.level };
      break;
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
      if (!("message" in event)) {
        const delta = event.assistantMessageEvent as {
          type: string;
          contentIndex?: number;
          delta?: string;
          content?: string;
        };
        let index = -1;
        for (let i = items.length - 1; i >= 0; i--) {
          const item = items[i];
          if (item?.kind === "message" && item.streaming && item.message.role === "assistant") {
            index = i;
            break;
          }
        }
        const item = index === -1 ? undefined : items[index];
        if (item?.kind === "message" && item.message.role === "assistant") {
          const message = JSON.parse(JSON.stringify(item.message)) as typeof item.message;
          const content = message.content as Array<{ type: string; text?: string; thinking?: string }>;
          const contentIndex = delta.contentIndex ?? 0;
          const block = content[contentIndex];
          if (delta.type === "text_start" && !block) content[contentIndex] = { type: "text", text: "" };
          if (delta.type === "text_delta") {
            if (!content[contentIndex]) content[contentIndex] = { type: "text", text: "" };
            content[contentIndex]!.text = `${content[contentIndex]!.text ?? ""}${delta.delta ?? ""}`;
          }
          if (delta.type === "text_end" && content[contentIndex]) {
            content[contentIndex]!.text = delta.content ?? content[contentIndex]!.text ?? "";
          }
          replaceItem(index, { ...item, message });
        }
        break;
      }
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
  return effects;
};

export const canSend = computed(
  () => connected.value && (Boolean(draft.value?.trim()) || images.value.length > 0),
);

// ─── 消息帧应用（事件驱动）──────────────────────────────────────────
// WS 层只负责把帧交给这里；本函数是客户端唯一的"官方事件处理"入口：
// snapshot 重建、event 应用官方事件、state 落服务器算好的显示状态。
// seq 间隙检测发现丢帧时调用 `resync`（由 WS 层注入）请求重同步。

/** 已应用的广播序号；发现间隙就请求 resync（快照会重置）。 */
let lastSeq = 0;
let resyncPending = false;

/** 推进 activity 并检测“非空闲 → 空闲”的回合结束边界。activity 由官方
 *  事件驱动（agent_settled / compaction_end → idle，agent_start /
 *  compaction_start / auto_retry_start → 非 idle），重连时由 snapshot
 *  携带的服务端当前值初始化。wasWorking 只防一次会话内的重复 settle；
 *  全新连接恢复成 idle 时活动本为 idle，不会误触发。 */
const advanceActivity = (next: AgentActivity): SessionEffect | undefined => {
  const wasWorking = activity.value.phase !== "idle";
  activity.value = next;
  if (wasWorking && next.phase === "idle") return { type: "session-settled" };
};

const requestResync = (resync: () => void) => {
  if (resyncPending) return;
  resyncPending = true;
  resync();
};

export const applyServerMessage = (message: ServerMessage, resync: () => void): SessionEffect[] => {
  const effects: SessionEffect[] = [];
  switch (message.type) {
    case "snapshot": {
      resyncPending = false;
      connected.value = true;
      const effect = advanceActivity(message.activity);
      if (effect) effects.push(effect);
      pending.value = message.pending;
      canRestorePending.value = message.canRestorePending;
      lastSeq = message.seq;
      conversationIdSeq = 0;
      conversation.value = buildConversationItems(message.messages, message.messageEntryIds);
      if ("model" in message) model.value = message.model;
      if (message.availableModels) availableModels.value = message.availableModels;
      if (message.thinking) thinking.value = message.thinking;
      if (message.stats) stats.value = message.stats;
      resources.value = message.resources;
      break;
    }
    case "state": {
      if (message.seq !== lastSeq + 1) {
        requestResync(resync);
        break;
      }
      lastSeq = message.seq;
      if (message.pending) pending.value = message.pending;
      if (message.resources) resources.value = message.resources;
      if ("model" in message) model.value = message.model;
      if (message.availableModels) availableModels.value = message.availableModels;
      if (message.thinking) thinking.value = message.thinking;
      if (message.stats) stats.value = message.stats;
      break;
    }
    case "extension_ui_request": {
      const req = message;
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
      effects.push({ type: "error", message: message.error });
      break;
    default: {
      const event = message as (AgentSessionEvent | JsonAgentSessionEvent) & { seq: number };
      if (message.seq !== lastSeq + 1) {
        requestResync(resync);
        break;
      }
      lastSeq = message.seq;
      effects.push(...applyEvent(event));
      break;
    }
  }
  return effects;
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
