import { useEffect, useRef } from "react";
import { MessageSquarePlus } from "lucide-react";
import type { ChatMessage } from "../../runtime/types";
import { Message } from "./Message";

export function ChatView({ messages, projectName, onOpenFile, onSuggestion }: { messages: ChatMessage[]; projectName?: string; onOpenFile(path: string): void; onSuggestion(text: string): void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);
  return <div className="chat-scroll">
    {messages.length === 0 ? <div className="empty-chat">
      <div className="empty-icon"><MessageSquarePlus size={22} /></div>
      <h1>{projectName ? `Work in ${projectName}` : "Start with a project"}</h1>
      <p>{projectName ? "Describe a change, ask about the code, or use a slash command." : "Open a local folder to create your first Pi session."}</p>
      {projectName && <div className="prompt-suggestions"><button onClick={() => onSuggestion("Review the current changes")}>Review the current changes</button><button onClick={() => onSuggestion("Explain this project structure")}>Explain this project structure</button><button onClick={() => onSuggestion("Find and fix a failing test")}>Find and fix a failing test</button></div>}
    </div> : <div className="message-list">{messages.map((message) => <Message key={message.id} message={message} onOpenFile={onOpenFile} />)}<div ref={end} /></div>}
  </div>;
}

