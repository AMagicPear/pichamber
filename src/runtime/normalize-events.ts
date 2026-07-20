import type { ChatMessage, ToolActivity, UiRequest } from "./types";

const textValue = (value: unknown): string => typeof value === "string" ? value : "";

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const value = part as Record<string, unknown>;
    return value.type === "text" ? textValue(value.text) : "";
  }).join("");
};

interface ReduceResult {
  messages: ChatMessage[];
  activeAssistant: Record<string, string | undefined>;
  runtimeError?: string;
  uiRequest?: UiRequest;
}

/**
 * Apply a single runtime event to the in-memory transcript and session flags.
 * Pure: returns a new state slice instead of mutating.
 */
export function reduceRuntimeEvent(
  sessionId: string,
  messages: ChatMessage[],
  activeAssistant: Record<string, string | undefined>,
  event: Record<string, unknown>,
): ReduceResult {
  const next = [...messages];
  const activeMap = { ...activeAssistant };
  const type = String(event.type ?? "");
  let runtimeError: string | undefined;
  let uiRequest: UiRequest | undefined;

  switch (type) {
    case "message_start": {
      const raw = (event.message ?? {}) as Record<string, unknown>;
      if (raw.role === "assistant") {
        const id = String(raw.id ?? crypto.randomUUID());
        activeMap[sessionId] = id;
        next.push({ id, role: "assistant", text: textFromContent(raw.content), tools: [], createdAt: Date.now(), streaming: true });
      }
      break;
    }
    case "message_update": {
      const id = activeMap[sessionId];
      const idx = next.findIndex((message) => message.id === id);
      if (idx === -1) break;
      const target = next[idx];
      const update = (event.assistantMessageEvent ?? {}) as Record<string, unknown>;
      if (update.type === "text_delta") {
        next[idx] = { ...target, text: target.text + textValue(update.delta) };
      }
      if (["thinking_delta", "reasoning_delta"].includes(String(update.type))) {
        next[idx] = { ...target, thinking: (target.thinking ?? "") + textValue(update.delta) };
      }
      if (update.type === "error") {
        next[idx] = { ...target, error: String(update.error ?? update.delta ?? "Response failed") };
      }
      break;
    }
    case "tool_execution_start": {
      let id = activeMap[sessionId];
      let targetIdx = next.findIndex((message) => message.id === id);
      if (targetIdx === -1) {
        id = crypto.randomUUID();
        activeMap[sessionId] = id;
        next.push({ id, role: "assistant", text: "", tools: [], createdAt: Date.now(), streaming: true });
        targetIdx = next.length - 1;
      }
      const target = next[targetIdx];
      const callId = String(event.toolCallId ?? crypto.randomUUID());
      const tool: ToolActivity = { id: callId, name: String(event.toolName ?? event.name ?? "Tool"), input: (event.args ?? event.input) as Record<string, unknown> | undefined, status: "running", startedAt: Date.now() };
      next[targetIdx] = { ...target, tools: [...target.tools, tool] };
      break;
    }
    case "tool_execution_update":
    case "tool_execution_end": {
      const targetIdx = next.findIndex((message) => message.id === activeMap[sessionId]);
      if (targetIdx === -1) break;
      const target = next[targetIdx];
      const toolIdx = target.tools.findIndex((value) => value.id === String(event.toolCallId));
      if (toolIdx === -1) break;
      const updatedTools = target.tools.map((t, i) =>
        i === toolIdx
          ? { ...t, output: event.result ?? event.partialResult, status: event.isError ? "error" as const : type === "tool_execution_end" ? "complete" as const : "running" as const }
          : t
      );
      next[targetIdx] = { ...target, tools: updatedTools };
      break;
    }
    case "message_end":
    case "turn_end":
    case "agent_end": {
      const targetIdx = next.findIndex((message) => message.id === activeMap[sessionId]);
      if (targetIdx !== -1) next[targetIdx] = { ...next[targetIdx], streaming: false };
      if (type !== "agent_end") delete activeMap[sessionId];
      break;
    }
    case "extension_ui_request": {
      const method = String(event.method);
      if (["select", "confirm", "input", "editor"].includes(method)) uiRequest = event as unknown as UiRequest;
      break;
    }
    case "error":
    case "extension_error":
    case "rpc_disconnected":
      runtimeError = String(event.error ?? event.errorMessage ?? "Pi runtime disconnected");
      break;
  }

  return { messages: next, activeAssistant: activeMap, runtimeError, uiRequest };
}