import { Check, Copy, GitFork, Paperclip, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import { IconButton } from "../../components/IconButton";
import type { ChatMessage } from "../../runtime/types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolBlock } from "./ToolBlock";

export function Message({
  message,
  onOpenFile,
  onOpenPath,
  cwd,
  canRegenerate,
  onRegenerate,
  onFork,
}: {
  message: ChatMessage;
  onOpenFile(path: string): void;
  onOpenPath?(path: string): void;
  cwd?: string;
  canRegenerate?: boolean;
  onRegenerate?(): void;
  onFork?(): void;
}) {
  if (message.role === "user") {
    // Parse @file references for display
    const lines = message.text.split("\n");
    const attachments: string[] = [];
    const displayLines: string[] = [];
    for (const line of lines) {
      if (line.trimStart().startsWith("@")) {
        const ref = line.trimStart().slice(1).trim();
        if (ref) attachments.push(ref);
      } else {
        displayLines.push(line);
      }
    }
    const displayText = displayLines.join("\n").trim() || message.text;

    return (
      <article className="message user-message">
        {attachments.length > 0 && (
          <div className="user-attachments">
            {attachments.map((path) => (
              <span key={path} className="user-attachment">
                <Paperclip size={10} /> {path}
              </span>
            ))}
          </div>
        )}
        {displayText && (
          <div className="user-bubble">
            <Markdown onOpenPath={onOpenPath}>{displayText}</Markdown>
          </div>
        )}
        {!displayText && attachments.length > 0 && (
          <div className="user-bubble">
            <Markdown onOpenPath={onOpenPath}>{message.text}</Markdown>
          </div>
        )}
        {displayText && <MessageActions text={message.text} />}
      </article>
    );
  }

  // Reasoning is auto-expanded while the upstream model is still streaming
  // (we don't know it's "done" until the assistant message ends). After
  // message.streaming flips false, ThinkingBlock collapses by default and the
  // user can click to expand.
  const thinkingStreaming = !!message.streaming && !!message.thinking;

  return (
    <article className="message assistant-message">
      <div className="assistant-heading">
        <span className="assistant-avatar"><Sparkles size={13} /></span>
        <strong>Pi</strong>
        {message.streaming && (
          <span className="streaming-label">
            <span className="pulse-dot" /> Working
          </span>
        )}
      </div>
      {(message.thinking || message.tools.length > 0) && (
        <div className="activity-rail">
          {message.thinking && (
            <ThinkingBlock
              text={message.thinking}
              streaming={thinkingStreaming}
              blockId={message.id}
            />
          )}
          {message.tools.map((tool) => (
            <ToolBlock key={tool.id} tool={tool} onOpenFile={onOpenFile} cwd={cwd} />
          ))}
        </div>
      )}
      {message.text && (
        <div>
          <Markdown onOpenPath={onOpenPath}>{message.text}</Markdown>
          {message.streaming && <span className="streaming-cursor" />}
        </div>
      )}
      {message.error && <div className="inline-error">{message.error}</div>}
      {!message.streaming && message.text && (
        <MessageActions text={message.text} align="left" canRegenerate={canRegenerate} onRegenerate={onRegenerate} onFork={onFork} />
      )}
    </article>
  );
}

function MessageActions({
  text,
  align,
  canRegenerate,
  onRegenerate,
  onFork,
}: {
  text: string;
  align?: "left";
  canRegenerate?: boolean;
  onRegenerate?(): void;
  onFork?(): void;
}) {
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
      {!isAssistant && (
        <IconButton label="Edit message" className="tiny" onClick={() => navigator.clipboard.writeText(text)}>
          <RotateCcw size={13} />
        </IconButton>
      )}
      {isAssistant && canRegenerate && onRegenerate && (
        <IconButton label="Regenerate response" className="tiny" onClick={onRegenerate}>
          <RefreshCw size={13} />
        </IconButton>
      )}
      {isAssistant && onFork && (
        <IconButton label="Fork from here" className="tiny" onClick={onFork}>
          <GitFork size={13} />
        </IconButton>
      )}
    </div>
  );
}
