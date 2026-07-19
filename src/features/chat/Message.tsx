import { Bot, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { IconButton } from "../../components/IconButton";
import type { ChatMessage } from "../../runtime/types";
import { ToolBlock } from "./ToolBlock";

export function Message({ message, onOpenFile }: { message: ChatMessage; onOpenFile(path: string): void }) {
  if (message.role === "user") return <article className="message user-message">
    <div className="user-bubble"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown></div>
    <div className="message-actions"><IconButton label="Copy message" onClick={() => navigator.clipboard.writeText(message.text)}><Copy size={14} /></IconButton></div>
  </article>;
  return <article className="message assistant-message">
    <div className="assistant-heading"><span className="assistant-avatar"><Bot size={14} /></span><strong>Pi</strong>{message.streaming && <span className="streaming-label">Working</span>}</div>
    {(message.thinking || message.tools.length > 0) && <div className="activity-rail">
      {message.thinking && <details className="thinking-block"><summary>Thinking</summary><div>{message.thinking}</div></details>}
      {message.tools.map((tool) => <ToolBlock key={tool.id} tool={tool} onOpenFile={onOpenFile} />)}
    </div>}
    {message.text && <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown></div>}
    {message.error && <div className="inline-error">{message.error}</div>}
    {!message.streaming && message.text && <div className="message-actions assistant-actions"><IconButton label="Copy response" onClick={() => navigator.clipboard.writeText(message.text)}><Copy size={14} /></IconButton></div>}
  </article>;
}

