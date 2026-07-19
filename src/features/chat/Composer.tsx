import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import type { ModelInfo, ThinkingLevel } from "../../runtime/types";
import { IconButton } from "../../components/IconButton";

interface Props {
  disabled: boolean;
  running: boolean;
  models: ModelInfo[];
  selectedModel?: ModelInfo;
  thinkingLevel: ThinkingLevel;
  onModel(model: ModelInfo): void;
  onThinking(level: ThinkingLevel): void;
  onSend(text: string): Promise<void>;
  onStop(): void;
  onAttach(): Promise<string | undefined>;
}

export function Composer(props: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, [props.disabled]);
  const submit = async () => {
    const value = text.trim();
    if (!value || props.disabled) return;
    setText("");
    const context = attachments.map((path) => `@${path}`).join(" ");
    setAttachments([]);
    await props.onSend(context ? `${context}\n\n${value}` : value);
  };
  return <div className="composer-wrap">
    <div className="composer">
      {attachments.length > 0 && <div className="attachment-row">{attachments.map((path) => <span key={path}><Paperclip size={12} />{path}<button aria-label={`Remove ${path}`} onClick={() => setAttachments((items) => items.filter((item) => item !== path))}><X size={12} /></button></span>)}</div>}
      <textarea ref={input} value={text} disabled={props.disabled} placeholder={props.disabled ? "Open a project to start" : "Ask Pi to work on this project"} rows={1}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
      <div className="composer-toolbar">
        <div className="composer-controls">
          <IconButton label="Attach file" onClick={() => void props.onAttach().then((path) => { if (path) setAttachments((items) => items.includes(path) ? items : [...items, path]); })}><Paperclip size={16} /></IconButton>
          <select aria-label="Model" value={props.selectedModel ? `${props.selectedModel.provider}/${props.selectedModel.id}` : ""} onChange={(event) => { const model = props.models.find((item) => `${item.provider}/${item.id}` === event.target.value); if (model) props.onModel(model); }}>
            {props.models.length === 0 && <option value="">Default model</option>}
            {props.models.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.id}</option>)}
          </select>
          <select aria-label="Thinking level" value={props.thinkingLevel} onChange={(event) => props.onThinking(event.target.value as ThinkingLevel)}>
            {(["off", "minimal", "low", "medium", "high", "xhigh"] as ThinkingLevel[]).map((level) => <option key={level}>{level}</option>)}
          </select>
        </div>
        {props.running ? <IconButton label="Stop response" className="send-button stop-button" onClick={props.onStop}><Square size={13} fill="currentColor" /></IconButton>
          : <IconButton label="Send message" className="send-button" disabled={!text.trim() || props.disabled} onClick={() => void submit()}><ArrowUp size={17} strokeWidth={2.5} /></IconButton>}
      </div>
    </div>
  </div>;
}

