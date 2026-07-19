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
      const target = next.find((message) => message.id === id);
      const update = (event.assistantMessageEvent ?? {}) as Record<string, unknown>;
      if (target && update.type === "text_delta") target.text += textValue(update.delta);
      if (target && ["thinking_delta", "reasoning_delta"].includes(String(update.type))) target.thinking = (target.thinking ?? "") + textValue(update.delta);
      if (target && update.type === "error") target.error = String(update.error ?? update.delta ?? "Response failed");
      break;
    }
    case "tool_execution_start": {
      let id = activeMap[sessionId];
      if (!id) {
        id = crypto.randomUUID();
        activeMap[sessionId] = id;
        next.push({ id, role: "assistant", text: "", tools: [], createdAt: Date.now(), streaming: true });
      }
      const target = next.find((message) => message.id === id);
      const callId = String(event.toolCallId ?? crypto.randomUUID());
      const tool: ToolActivity = { id: callId, name: String(event.toolName ?? event.name ?? "Tool"), input: (event.args ?? event.input) as Record<string, unknown> | undefined, status: "running", startedAt: Date.now() };
      target?.tools.push(tool);
      break;
    }
    case "tool_execution_update":
    case "tool_execution_end": {
      const target = next.find((message) => message.id === activeMap[sessionId]);
      const tool = target?.tools.find((value) => value.id === String(event.toolCallId));
      if (tool) {
        tool.output = event.result ?? event.partialResult;
        tool.status = event.isError ? "error" : type === "tool_execution_end" ? "complete" : "running";
      }
      break;
    }
    case "message_end":
    case "turn_end":
    case "agent_end": {
      const target = next.find((message) => message.id === activeMap[sessionId]);
      if (target) target.streaming = false;
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