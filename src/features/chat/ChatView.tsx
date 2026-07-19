import { useEffect, useRef } from "react";
import type { ChatMessage } from "../../runtime/types";
import { ChatEmptyState } from "./ChatEmptyState";
import { Message } from "./Message";

interface Props {
  messages: ChatMessage[];
  projectName?: string;
  onOpenFile(path: string): void;
  onSuggestion(text: string): void;
}

export function ChatView({ messages, projectName, onOpenFile, onSuggestion }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length]);
  return (
    <div className="chat-scroll">
      {messages.length === 0
        ? <ChatEmptyState projectName={projectName} onSuggestion={onSuggestion} />
        : (
          <div className="message-list">
            {messages.map((message) => <Message key={message.id} message={message} onOpenFile={onOpenFile} />)}
            <div ref={end} />
          </div>
        )}
    </div>
  );
}