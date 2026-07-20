// ─────────────────────────────────────────────────────────────────────────────
// Pure event reducer. Each Pi runtime event is folded into a SessionView
// (the slice of state pichamber cares about). No globals, no side effects.
//
// Source of truth:
//   - pi/packages/coding-agent/src/core/agent-session.ts  (L136-163 events)
//   - pi/packages/agent/src/types.ts                      (L415-430 events)
//
// Message identity: Pi's `Message` types don't carry an `id` field. We use
// `timestamp` (set once on creation, stable for the message's lifetime) to
// match a streaming message across `message_start` / `message_update` /
// `message_end` events.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AgentMessage,
  AssistantMessage,
  Model,
  RpcExtensionUIRequest,
  RpcSessionState,
  RunningTool,
  RuntimeEvent,
  ThinkingLevel,
  ToolResultMessage,
} from "./types";

export interface SessionView {
  /** Mirrors Pi's `get_state` response — the canonical session state. */
  state: RpcSessionState;
  /** All messages seen in this session, in order. Includes `toolResult`
   *  messages emitted by Pi as separate `AgentMessage`s. */
  messages: AgentMessage[];
  /** Live tool state — populated from `tool_execution_*` events. Keyed by
   *  `toolCallId`. Pi doesn't fold this into any message, so we track it
   *  separately for streaming UI. */
  runningTools: Map<string, RunningTool>;
  /** Current UI request, if Pi is waiting for user input. */
  uiRequest?: RpcExtensionUIRequest;
  /** Last error string (cleared on the next successful event). */
  error?: string;
}

const EMPTY_STATE: RpcSessionState = {
  thinkingLevel: "medium",
  isStreaming: false,
  isCompacting: false,
  steeringMode: "all",
  followUpMode: "all",
  sessionId: "",
  autoCompactionEnabled: true,
  messageCount: 0,
  pendingMessageCount: 0,
};

export function initialView(): SessionView {
  return {
    state: { ...EMPTY_STATE },
    messages: [],
    runningTools: new Map(),
  };
}

const ts = (m: AgentMessage): number => (m as { timestamp: number }).timestamp;

const replaceByTimestamp = (messages: AgentMessage[], next: AgentMessage): AgentMessage[] => {
  const next_ts = ts(next);
  const idx = messages.findIndex((m) => ts(m) === next_ts);
  if (idx === -1) return [...messages, next];
  const copy = messages.slice();
  copy[idx] = next;
  return copy;
};

const isDialog = (
  req: RpcExtensionUIRequest,
): req is Extract<RpcExtensionUIRequest, { method: "select" | "confirm" | "input" | "editor" }> =>
  req.method === "select" || req.method === "confirm" || req.method === "input" || req.method === "editor";

/** Apply one event to a SessionView. Pure: returns a new view. */
export function applyEvent(prev: SessionView, event: RuntimeEvent): SessionView {
  const t = event.type;

  switch (t) {
    case "message_start": {
      const message = (event as { message: AgentMessage }).message;
      return { ...prev, messages: [...prev.messages, message] };
    }
    case "message_update": {
      const message = (event as { message: AgentMessage }).message;
      return { ...prev, messages: replaceByTimestamp(prev.messages, message) };
    }
    case "message_end": {
      const message = (event as { message: AgentMessage }).message;
      return { ...prev, messages: replaceByTimestamp(prev.messages, message) };
    }
    case "turn_end": {
      const e = event as { message: AgentMessage; toolResults: ToolResultMessage[] };
      const messages = replaceByTimestamp(prev.messages, e.message);
      for (const tr of e.toolResults) {
        if (!messages.find((m) => m.role === "toolResult" && m.toolCallId === tr.toolCallId)) {
          messages.push(tr);
        }
      }
      const runningTools = new Map(prev.runningTools);
      for (const tr of e.toolResults) {
        const running = runningTools.get(tr.toolCallId);
        if (running) {
          runningTools.set(tr.toolCallId, {
            ...running,
            result: tr.content,
            isError: tr.isError,
            endedAt: tr.timestamp,
          });
        }
      }
      return { ...prev, messages, runningTools };
    }

    case "tool_execution_start": {
      const e = event as { toolCallId: string; toolName: string; args: unknown };
      const runningTools = new Map(prev.runningTools);
      runningTools.set(e.toolCallId, {
        toolCallId: e.toolCallId,
        toolName: e.toolName,
        args: e.args,
        startedAt: Date.now(),
      });
      return { ...prev, runningTools };
    }
    case "tool_execution_update": {
      const e = event as { toolCallId: string; partialResult: unknown };
      const runningTools = new Map(prev.runningTools);
      const running = runningTools.get(e.toolCallId);
      if (running) runningTools.set(e.toolCallId, { ...running, partialResult: e.partialResult });
      return { ...prev, runningTools };
    }
    case "tool_execution_end": {
      const e = event as { toolCallId: string; result: unknown; isError: boolean };
      const runningTools = new Map(prev.runningTools);
      const running = runningTools.get(e.toolCallId);
      if (running) {
        runningTools.set(e.toolCallId, {
          ...running,
          result: e.result,
          isError: e.isError,
          endedAt: Date.now(),
        });
      }
      return { ...prev, runningTools };
    }

    case "agent_start":
      return { ...prev, state: { ...prev.state, isStreaming: true } };
    case "agent_end":
    case "agent_settled":
      return { ...prev, state: { ...prev.state, isStreaming: false } };
    case "turn_start":
      return prev;

    case "compaction_start":
      return { ...prev, state: { ...prev.state, isCompacting: true } };
    case "compaction_end":
      return { ...prev, state: { ...prev.state, isCompacting: false } };

    case "thinking_level_changed": {
      const level = (event as { level: ThinkingLevel }).level;
      return { ...prev, state: { ...prev.state, thinkingLevel: level } };
    }
    case "model_select": {
      const model = (event as unknown as { model: Model }).model;
      return { ...prev, state: { ...prev.state, model } };
    }
    case "session_info_changed": {
      const name = (event as { name: string | undefined }).name;
      return { ...prev, state: { ...prev.state, sessionName: name } };
    }

    case "extension_ui_request": {
      const req = event as RpcExtensionUIRequest;
      if (isDialog(req)) return { ...prev, uiRequest: req };
      return prev;
    }

    case "error":
    case "extension_error":
      return { ...prev, error: String((event as { error?: string }).error ?? "Pi runtime error") };

    default:
      return prev;
  }
}

/** Apply a stream of events from Pi. Convenience wrapper for the
 *  `subscribe(handler)` flow. */
export function applyEvents(prev: SessionView, events: RuntimeEvent[]): SessionView {
  let view = prev;
  for (const event of events) view = applyEvent(view, event);
  return view;
}

/** Look up a tool result by toolCallId in a message list. Pi emits
 *  `ToolResultMessage` as a separate message; we search the linear list. */
export function findToolResult(messages: AgentMessage[], toolCallId: string): ToolResultMessage | undefined {
  for (const m of messages) {
    if (m.role === "toolResult" && m.toolCallId === toolCallId) return m;
  }
  return undefined;
}

/** Pull the streaming assistant message timestamp, if any. Used by the
 *  auto-scroll + cursor logic. */
export function streamingAssistantTimestamp(view: SessionView): number | undefined {
  if (!view.state.isStreaming) return undefined;
  for (let i = view.messages.length - 1; i >= 0; i--) {
    const m = view.messages[i];
    if (m.role === "assistant") return ts(m);
  }
  return undefined;
}

/** Extract a flat "thinking" string from an assistant message's content. */
export function assistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "thinking"; thinking: string } => c.type === "thinking")
    .map((c) => c.thinking)
    .join("");
}

/** Extract a flat "text" string from an assistant message's content. */
export function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/** Extract all tool calls from an assistant message. */
export function assistantToolCalls(
  message: AssistantMessage,
): Array<Extract<AssistantMessage["content"][number], { type: "toolCall" }>> {
  return message.content.filter((c): c is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => c.type === "toolCall");
}

export type { AgentMessage, AssistantMessage, ToolResultMessage, RunningTool, RpcSessionState, RpcExtensionUIRequest, RuntimeEvent };
