import type { ChatMessage, ToolActivity } from "./types";

const textValue = (value: unknown) => typeof value === "string" ? value : "";

export function normalizeBackendMessages(rawMessages: unknown[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const tools = new Map<string, { message: ChatMessage; tool: ToolActivity }>();
  for (const item of rawMessages) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const role = String(raw.role ?? "");
    if (role === "user") {
      const content = raw.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => typeof part === "string" ? part : textValue((part as Record<string, unknown>)?.text)).join("") : "";
      result.push({ id: String(raw.id ?? crypto.randomUUID()), role: "user", text, tools: [], createdAt: Date.now() });
      continue;
    }
    if (role === "assistant") {
      const message: ChatMessage = { id: String(raw.id ?? crypto.randomUUID()), role: "assistant", text: "", thinking: "", tools: [], createdAt: Date.now(), streaming: false };
      if (Array.isArray(raw.content)) for (const part of raw.content) {
        if (!part || typeof part !== "object") continue;
        const value = part as Record<string, unknown>;
        if (value.type === "text") message.text += textValue(value.text);
        if (["thinking", "reasoning"].includes(String(value.type))) message.thinking += textValue(value.thinking ?? value.reasoning ?? value.text);
        if (value.type === "toolCall") {
          const tool: ToolActivity = { id: String(value.id ?? crypto.randomUUID()), name: String(value.name ?? "Tool"), input: value.arguments as Record<string, unknown> | undefined, status: "complete", startedAt: Date.now() };
          message.tools.push(tool); tools.set(tool.id, { message, tool });
        }
      }
      if (!message.thinking) delete message.thinking;
      result.push(message); continue;
    }
    if (role === "toolResult") {
      const target = tools.get(String(raw.toolCallId ?? ""));
      if (target) { target.tool.output = raw.content ?? raw.result; target.tool.status = raw.isError ? "error" : "complete"; }
      continue;
    }
    if (role === "bashExecution") {
      result.push({ id: String(raw.id ?? crypto.randomUUID()), role: "assistant", text: "", tools: [{ id: String(raw.id ?? crypto.randomUUID()), name: "bash", input: { command: raw.command }, output: raw.output, status: "complete", startedAt: Date.now() }], createdAt: Date.now() });
    }
  }
  return result;
}

