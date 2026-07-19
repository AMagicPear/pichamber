import type { ChatMessage, ToolActivity } from "./types";

const textValue = (value: unknown): string => typeof value === "string" ? value : "";

const joinText = (parts: unknown): string => {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => textValue((part as Record<string, unknown>)?.text)).join("");
};

const findTool = (tools: Map<string, { message: ChatMessage; tool: ToolActivity }>, id: string | undefined) =>
  id ? tools.get(String(id)) : undefined;

export function normalizeBackendMessages(rawMessages: unknown[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const tools = new Map<string, { message: ChatMessage; tool: ToolActivity }>();

  for (const item of rawMessages) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const role = String(raw.role ?? "");

    if (role === "user") {
      result.push({ id: String(raw.id ?? crypto.randomUUID()), role: "user", text: joinText(raw.content), tools: [], createdAt: Date.now() });
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
          message.tools.push(tool);
          tools.set(tool.id, { message, tool });
        }
      }
      if (!message.thinking) delete message.thinking;
      result.push(message);
      continue;
    }

    if (role === "toolResult") {
      const target = findTool(tools, raw.toolCallId as string | undefined);
      if (target) { target.tool.output = raw.content ?? raw.result; target.tool.status = raw.isError ? "error" : "complete"; }
      continue;
    }

    if (role === "bashExecution") {
      const id = String(raw.id ?? crypto.randomUUID());
      result.push({ id, role: "assistant", text: "", tools: [{ id, name: "bash", input: { command: raw.command }, output: raw.output, status: "complete", startedAt: Date.now() }], createdAt: Date.now() });
    }
  }

  return result;
}