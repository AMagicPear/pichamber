import type { AgentSessionEvent, JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";

type JsonMessageUpdate = Extract<JsonAgentSessionEvent, { type: "message_update" }>;

const contentAt = (message: AssistantMessage, index: number) => message.content[index];

const withContent = (
  message: AssistantMessage,
  index: number,
  content: TextContent | ThinkingContent | ToolCall,
): AssistantMessage => {
  const next = [...message.content];
  next[index] = content;
  return { ...message, content: next };
};

const applyDelta = (message: AssistantMessage, update: JsonMessageUpdate): AssistantMessage => {
  const event = update.assistantMessageEvent;
  let next = { ...message, usage: update.usage };
  if (event.type === "text_start") {
    next = withContent(next, event.contentIndex, { type: "text", text: "" });
  } else if (event.type === "text_delta") {
    const current = contentAt(next, event.contentIndex);
    const text = current?.type === "text" ? current.text : "";
    next = withContent(next, event.contentIndex, { type: "text", text: text + event.delta });
  } else if (event.type === "text_end") {
    next = withContent(next, event.contentIndex, { type: "text", text: event.content });
  } else if (event.type === "thinking_start") {
    next = withContent(next, event.contentIndex, { type: "thinking", thinking: "" });
  } else if (event.type === "thinking_delta") {
    const current = contentAt(next, event.contentIndex);
    const thinking = current?.type === "thinking" ? current.thinking : "";
    next = withContent(next, event.contentIndex, {
      type: "thinking",
      thinking: thinking + event.delta,
    });
  } else if (event.type === "thinking_end") {
    next = withContent(next, event.contentIndex, { type: "thinking", thinking: event.content });
  } else if (event.type === "toolcall_start") {
    next = withContent(next, event.contentIndex, {
      type: "toolCall",
      id: "",
      name: "",
      arguments: {},
    });
  } else if (event.type === "toolcall_end") {
    next = withContent(next, event.contentIndex, event.toolCall);
  }
  return next;
};

/** Restores the cumulative message snapshots omitted by Pi's JSON/RPC wire protocol. */
export class RpcMessageStream {
  private message: AssistantMessage | undefined;

  normalize(event: JsonAgentSessionEvent): AgentSessionEvent | undefined {
    if (event.type === "message_start") {
      this.message = event.message.role === "assistant"
        ? structuredClone(event.message as AssistantMessage)
        : undefined;
      return event;
    }
    if (event.type === "message_end") {
      this.message = undefined;
      return event;
    }
    if (event.type !== "message_update") return event;
    if (!this.message) return undefined;

    this.message = applyDelta(this.message, event);
    const assistantMessageEvent = {
      ...event.assistantMessageEvent,
      partial: this.message,
    } as AssistantMessageEvent;
    return { ...event, message: this.message, assistantMessageEvent } as AgentSessionEvent;
  }
}
