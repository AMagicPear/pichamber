import { Bot, Check, Copy, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconButton } from "../../components/IconButton";
import type { ChatMessage } from "../../runtime/types";
import { ToolBlock } from "./ToolBlock";

export function Message({ message, onOpenFile }: { message: ChatMessage; onOpenFile(path: string): void }) {
  if (message.role === "user") {
    return (
      <article className="message user-message">
        <div className="user-bubble">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        </div>
        <MessageActions text={message.text} />
      </article>
    );
  }

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
            <details className="thinking-block">
              <summary>Thinking</summary>
              <div>{message.thinking}</div>
            </details>
          )}
          {message.tools.map((tool) => (
            <ToolBlock key={tool.id} tool={tool} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
      {message.text && (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        </div>
      )}
      {message.error && <div className="inline-error">{message.error}</div>}
      {!message.streaming && message.text && (
        <MessageActions text={message.text} align="left" />
      )}
    </article>
  );
}

function MessageActions({ text, align }: { text: string; align?: "left" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`message-actions ${align === "left" ? "assistant-actions" : ""}`}>
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
      <IconButton label="Insert as new prompt" className="tiny" onClick={() => navigator.clipboard.writeText(text)}>
        <RotateCcw size={13} />
      </IconButton>
    </div>
  );
}

// Re-export Bot in case something else imports it from here.
export const PiAvatar = Bot;