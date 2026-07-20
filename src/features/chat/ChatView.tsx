import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { ChatMessage } from "../../runtime/types";
import { ChatEmptyState } from "./ChatEmptyState";
import { Message } from "./Message";

interface Props {
  messages: ChatMessage[];
  projectName?: string;
  /** Active working directory. Strips the prefix off absolute paths so tool
   *  summaries show short relative paths (OpenChamber-style). */
  cwd?: string;
  loading?: boolean;
  onOpenFile(path: string): void;
  onSuggestion(text: string): void;
  onRegenerate(): void;
  onFork(): void;
}

export const ChatView = memo(function ChatView({ messages, projectName, cwd, loading, onOpenFile, onSuggestion, onRegenerate, onFork }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const onFileRef = useRef(onOpenFile);
  useEffect(() => { onFileRef.current = onOpenFile; }, [onOpenFile]);

  // Track whether the user is near the bottom via scroll events, not by
  // sampling after React commits (which would always report false because
  // scrollHeight already increased while scrollTop hasn't moved yet).
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < threshold;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // When the message list identity changes (new session), reset to
  // auto-scroll and jump to bottom immediately.
  useEffect(() => {
    autoScrollRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Auto-scroll to bottom when new content arrives, but only if the user
  // hasn't manually scrolled up. Using useLayoutEffect so the scroll
  // happens synchronously before paint — no visible jump.
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
                  key={message.id}
                  message={message}
                  onOpenFile={onOpenFile}
                  onOpenPath={(path) => onFileRef.current(path)}
                  cwd={cwd}
                  canRegenerate={message.role === "assistant" && message.id === lastAssistantId}
                  onRegenerate={onRegenerate}
                  onFork={onFork}
                />
              ))}
            </div>
          )}
    </div>
  );
});
