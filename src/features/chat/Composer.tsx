import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { Brain, ChevronDown, Send, Square } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import {
  EXTENDED_THINKING_LEVELS,
  getSupportedThinkingLevels,
  type Model,
  type ModelThinkingLevel,
} from "../../runtime/types";

interface Props {
  disabled?: boolean;
  running?: boolean;
  models: Model[];
  selectedModel?: Model;
  thinkingLevel: ModelThinkingLevel;
  onModel(model: Model): void;
  onThinking(level: ModelThinkingLevel): void;
  onSend(text: string): void;
  onStop(): void;
}

const THINKING_LABELS: Record<ModelThinkingLevel, string> = {
  off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "X-High", max: "Max",
};

const displayModel = (model: Model): string => {
  const slash = model.id.indexOf("/");
  return slash >= 0 ? model.id.slice(slash + 1) : model.name || model.id;
};

export function Composer(props: Props) {
  const [text, setText] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const draftRef = useRef("");
  const sending = text.trim().length > 0;
  const modelId = props.selectedModel?.id ?? "";
  const supportedLevels = props.selectedModel ? getSupportedThinkingLevels(props.selectedModel) : ["off"];
  const availableThinkingLevels = EXTENDED_THINKING_LEVELS.filter((l) => supportedLevels.includes(l));

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const pushHistory = useCallback((value: string) => {
    if (value && historyRef.current[historyRef.current.length - 1] !== value) {
      historyRef.current.push(value);
    }
    historyIdxRef.current = historyRef.current.length;
    draftRef.current = "";
  }, []);

  const handleSubmit = (event?: FormEvent) => {
    if (event) event.preventDefault();
    if (props.running) return;
    if (!sending) return;
    const trimmed = text.trim();
    pushHistory(trimmed);
    props.onSend(trimmed);
    setText("");
    requestAnimationFrame(() => textarea.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSubmit();
      return;
    }
    if (event.key === "ArrowUp" && !event.shiftKey && !event.ctrlKey && !event.metaKey && textarea.current?.selectionStart === 0) {
      event.preventDefault();
      const hist = historyRef.current;
      if (hist.length === 0) return;
      if (historyIdxRef.current === hist.length) draftRef.current = text;
      const next = Math.max(0, historyIdxRef.current - 1);
      historyIdxRef.current = next;
      setText(hist[next]);
      requestAnimationFrame(() => {
        const ta = textarea.current;
        if (ta) { ta.selectionStart = ta.selectionEnd = ta.value.length; }
      });
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const hist = historyRef.current;
      if (historyIdxRef.current >= hist.length) return;
      event.preventDefault();
      const next = historyIdxRef.current + 1;
      historyIdxRef.current = next;
      if (next >= hist.length) {
        setText(draftRef.current);
        draftRef.current = "";
      } else {
        setText(hist[next]);
      }
      requestAnimationFrame(() => {
        const ta = textarea.current;
        if (ta) { ta.selectionStart = ta.selectionEnd = ta.value.length; }
      });
    }
  };

  return (
    <form className="composer-wrap" onSubmit={handleSubmit}>
      <div className="composer">
        <textarea
          ref={textarea}
          value={text}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            props.disabled
              ? "Open a project to start a session"
              : props.running
                ? "Pi is working… (Shift+Enter for new line)"
                : "Ask Pi anything… (Enter to send, Shift+Enter for new line)"
          }
          rows={1}
          disabled={props.disabled}
        />
        <div className="composer-toolbar">
          <div className="composer-controls">
            {props.models.length > 0 && (
              <label className="composer-pill model-pill" title="Change model">
                <span className="pill-text">{props.selectedModel ? displayModel(props.selectedModel) : "Model"}</span>
                <ChevronDown size={10} className="pill-chevron" />
                <select
                  aria-label="Model"
                  value={modelId}
                  onChange={(e) => {
                    const next = props.models.find((m) => m.id === e.target.value);
                    if (next) props.onModel(next);
                  }}
                >
                  {props.models.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={m.id}>{displayModel(m)}</option>
                  ))}
                </select>
              </label>
            )}

            <label className={`composer-pill ${props.thinkingLevel !== "off" ? "is-active" : ""}`} title="Thinking level">
              <Brain size={12} />
              <span className="pill-text">{THINKING_LABELS[props.thinkingLevel]}</span>
              <ChevronDown size={10} className="pill-chevron" />
              <select
                aria-label="Thinking level"
                value={props.thinkingLevel}
                onChange={(e) => props.onThinking(e.target.value as ModelThinkingLevel)}
              >
                {availableThinkingLevels.map((k) => (
                  <option key={k} value={k}>{THINKING_LABELS[k]}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="composer-actions">
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
      </div>
    </form>
  );
}
