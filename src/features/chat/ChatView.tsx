import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { AgentMessage, RunningTool } from "../../runtime/types";
import { findToolResult } from "../../runtime/events";
import { ChatEmptyState } from "./ChatEmptyState";
import { Message } from "./Message";

interface Props {
  messages: AgentMessage[];
  runningTools: Map<string, RunningTool>;
  projectName?: string;
  cwd?: string;
  loading?: boolean;
  onOpenFile(path: string): void;
  onSuggestion(text: string): void;
}

export const ChatView = memo(function ChatView({ messages, runningTools, projectName, cwd, loading, onOpenFile, onSuggestion }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const isEmpty = messages.length === 0;
  useEffect(() => {
    autoScrollRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isEmpty]);

  useLayoutEffect(() => {
    if (autoScrollRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  });

  return (
    <div ref={scrollRef} className="chat-scroll">
      {loading
        ? <div className="chat-loading" />
        : messages.length === 0
          ? <ChatEmptyState projectName={projectName} onSuggestion={onSuggestion} />
          : (
            <div className="message-list">
              {messages.map((message) => (
                <Message
                  key={`${message.role}:${(message as { timestamp: number }).timestamp}`}
                  message={message}
                  runningTools={runningTools}
                  findResult={findToolResult}
                  onOpenFile={onOpenFile}
                  cwd={cwd}
                />
              ))}
            </div>
          )}
    </div>
  );
});
