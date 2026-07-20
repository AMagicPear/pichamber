import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../runtime/types";
import { ChatEmptyState } from "./ChatEmptyState";
import { Message } from "./Message";

interface Props {
  messages: ChatMessage[];
  projectName?: string;
  /** Active working directory. Strips the prefix off absolute paths so tool
   *  summaries show short relative paths (OpenChamber-style). */
  cwd?: string;
  onOpenFile(path: string): void;
  onSuggestion(text: string): void;
  onRegenerate(): void;
  onFork(): void;
}

export function ChatView({ messages, projectName, cwd, onOpenFile, onSuggestion, onRegenerate, onFork }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const onFileRef = useRef(onOpenFile);
  useEffect(() => { onFileRef.current = onOpenFile; }, [onOpenFile]);

  // OpenChamber auto-scroll: ResizeObserver + following ref
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (followingRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) followingRef.current = false;
    };
    el.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Re-engage follow + scroll on new message
  useEffect(() => {
    followingRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={scrollRef} className="chat-scroll">
      {messages.length === 0
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
}
