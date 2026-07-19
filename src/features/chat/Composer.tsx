import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Brain, ChevronDown, Paperclip, Send, Square, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ModelInfo, ThinkingLevel } from "../../runtime/types";

interface Props {
  disabled?: boolean;
  running?: boolean;
  models: ModelInfo[];
  selectedModel?: ModelInfo;
  thinkingLevel: ThinkingLevel;
  attachments: string[];
  onModel(model: ModelInfo): void;
  onThinking(level: ThinkingLevel): void;
  onAttach(): Promise<string | undefined>;
  onRemoveAttachment(path: string): void;
  onSend(text: string): void;
  onStop(): void;
}

const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
];

const displayModel = (model: ModelInfo): string => {
  const slash = model.id.indexOf("/");
  return slash >= 0 ? model.id.slice(slash + 1) : model.id;
};

const labelForThinking = (level: ThinkingLevel): string =>
  THINKING_LEVELS.find((entry) => entry.value === level)?.label ?? "Medium";

export function Composer(props: Props) {
  const [text, setText] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sending = text.trim().length > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (props.running) return;
    if (!sending) return;
    props.onSend(text.trim());
    setText("");
    requestAnimationFrame(() => textarea.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  const handleAttach = async () => {
    const path = await props.onAttach();
    if (path) textarea.current?.focus();
  };

  return (
    <form className="composer-wrap" onSubmit={handleSubmit}>
      <div className="composer">
        {props.attachments.length > 0 && (
          <div className="attachment-row">
            {props.attachments.map((path) => (
              <span key={path} className="chip" title={path}>
                <Paperclip size={11} /> {path}
                <button type="button" aria-label={`Remove ${path}`} onClick={() => props.onRemoveAttachment(path)}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          value={text}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            props.disabled
              ? "Open a project to start a Pi session"
              : props.running
                ? "Pi is working… (Shift+Enter for new line)"
                : "Ask Pi anything… (Enter to send)"
          }
          rows={1}
          disabled={props.disabled}
        />
        <div className="composer-toolbar">
          <div className="composer-controls">
            <label className="composer-pill model-pill">
              <span className="pill-text">
                {props.selectedModel ? displayModel(props.selectedModel) : props.models.length === 0 ? "Loading models…" : "Pick a model"}
              </span>
              <ChevronDown size={12} className="pill-chevron" />
              <select
                aria-label="Model"
                value={props.selectedModel?.id ?? ""}
                onChange={(event) => {
                  const next = props.models.find((model) => model.id === event.target.value);
                  if (next) props.onModel(next);
                }}
              >
                {props.models.length === 0 && <option value="">Loading models…</option>}
                {props.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {displayModel(model)}
                  </option>
                ))}
              </select>
            </label>
            <label className={`composer-pill thinking-pill ${props.thinkingLevel !== "off" ? "is-active" : ""}`}>
              <Brain size={13} />
              <span className="pill-text">{labelForThinking(props.thinkingLevel)}</span>
              <ChevronDown size={11} className="pill-chevron" />
              <select
                aria-label="Thinking level"
                value={props.thinkingLevel}
                onChange={(event) => props.onThinking(event.target.value as ThinkingLevel)}
              >
                {THINKING_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    Thinking: {level.label}
                  </option>
                ))}
              </select>
            </label>
            <IconButton label="Attach file" className="tiny" onClick={handleAttach} disabled={props.disabled}>
              <Paperclip size={15} />
            </IconButton>
          </div>
          {props.running ? (
            <IconButton label="Stop" className="stop-button" onClick={props.onStop}>
              <Square size={13} fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton label="Send" className="send-button" type="submit" disabled={!sending}>
              <Send size={14} />
            </IconButton>
          )}
        </div>
      </div>
    </form>
  );
}