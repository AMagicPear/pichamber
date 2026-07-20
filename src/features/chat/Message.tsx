import { Check, Copy, Sparkles } from "lucide-react";
import { memo, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { IconButton } from "../../components/IconButton";
import {
  assistantText,
  assistantThinking,
  assistantToolCalls,
} from "../../runtime/events";
import type {
  AgentMessage,
  AssistantMessage,
  RunningTool,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "../../runtime/types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolBlock } from "./ToolBlock";

interface Props {
  message: AgentMessage;
  runningTools: Map<string, RunningTool>;
  findResult(messages: AgentMessage[], toolCallId: string): ToolResultMessage | undefined;
  onOpenFile(path: string): void;
  cwd?: string;
}

export const Message = memo(function Message({ message, runningTools, findResult, onOpenFile, cwd }: Props) {
  if (message.role === "user") return <UserBubble message={message} onOpenFile={onOpenFile} />;
  if (message.role === "assistant") return <AssistantBubble message={message} runningTools={runningTools} findResult={findResult} onOpenFile={onOpenFile} cwd={cwd} />;
  // toolResult messages are surfaced inline on their corresponding ToolBlock,
  // so the linear renderer skips them.
  return null;
});

function UserBubble({ message, onOpenFile }: { message: UserMessage; onOpenFile(path: string): void }) {
  const text = typeof message.content === "string"
    ? message.content
    : message.content
        .filter((c): c is TextContent => c.type === "text")
        .map((c) => c.text)
        .join("");
  return (
    <article className="message user-message">
      <div className="user-bubble">
        <Markdown onOpenPath={onOpenFile}>{text}</Markdown>
      </div>
      <MessageActions text={text} />
    </article>
  );
}

function AssistantBubble({
  message,
  runningTools,
  findResult,
  onOpenFile,
  cwd,
}: {
  message: AssistantMessage;
  runningTools: Map<string, RunningTool>;
  findResult: (messages: AgentMessage[], toolCallId: string) => ToolResultMessage | undefined;
  onOpenFile(path: string): void;
  cwd?: string;
}) {
  const thinking = assistantThinking(message);
  const text = assistantText(message);
  const toolCalls = assistantToolCalls(message);
  const isStreaming = message.stopReason === undefined || message.stopReason === "error";

  return (
    <article className="message assistant-message">
      <div className="assistant-heading">
        <span className="assistant-avatar"><Sparkles size={13} /></span>
        <strong>Pi</strong>
        {isStreaming && (
          <span className="streaming-label">
            <span className="pulse-dot" /> Working
          </span>
        )}
      </div>
      {(thinking || toolCalls.length > 0) && (
        <div className="activity-rail">
          {thinking && (
            <ThinkingBlock text={thinking} streaming={isStreaming} blockId={String(message.timestamp)} />
          )}
          {toolCalls.map((call) => (
            <ToolBlock
              key={call.id}
              call={call}
              result={findResult([message], call.id) ?? findRunningToolResult(runningTools, call.id)}
              running={runningTools.get(call.id)}
              onOpenFile={onOpenFile}
              cwd={cwd}
            />
          ))}
        </div>
      )}
      {text && (
        <div>
          <Markdown>{text}</Markdown>
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}
      {message.errorMessage && <div className="inline-error">{message.errorMessage}</div>}
      {!isStreaming && text && <MessageActions text={text} align="left" />}
    </article>
  );
}

function findRunningToolResult(running: Map<string, RunningTool>, toolCallId: string): ToolResultMessage | undefined {
  const r = running.get(toolCallId);
  if (!r) return undefined;
  // Synthesize a ToolResultMessage from the live running state — useful
  // when the user switches sessions before the official `turn_end` arrives.
  return {
    role: "toolResult",
    toolCallId,
    toolName: r.toolName,
    content: typeof r.result === "string" ? [{ type: "text", text: r.result }] : [],
    isError: r.isError ?? false,
    timestamp: r.endedAt ?? r.startedAt,
  };
}

function MessageActions({ text, align }: { text: string; align?: "left" }) {
  const [copied, setCopied] = useState(false);
  const isAssistant = align === "left";
  return (
    <div className={`message-actions ${isAssistant ? "assistant-actions" : ""}`}>
      <IconButton
        label={copied ? "Copied" : "Copy"}
        className="tiny"
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </IconButton>
    </div>
  );
}

// Re-exports kept for backwards compatibility with the rest of the app.
export type { AgentMessage, AssistantMessage, ThinkingContent, ToolCall, TextContent };
