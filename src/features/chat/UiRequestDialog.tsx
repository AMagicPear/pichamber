import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { UiRequest } from "../../runtime/types";

export function UiRequestDialog({ request, onAnswer }: { request: UiRequest; onAnswer(value: string | boolean | undefined): void }) {
  const [value, setValue] = useState(request.prefill ?? "");
  const [closing, setClosing] = useState(false);
  const answeringRef = useRef(false);
  // Reset the draft whenever the underlying request changes (e.g. a new
  // question comes in mid-turn).
  useEffect(() => { setValue(request.prefill ?? ""); }, [request.id, request.prefill]);

  // Play the exit animation before handing the answer back to the parent,
  // which unmounts this dialog. Matches --motion-dialog (150ms) in styles.css.
  const answer = (result: string | boolean | undefined) => {
    if (answeringRef.current) return;
    answeringRef.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onAnswer(result);
      return;
    }
    setClosing(true);
    window.setTimeout(() => onAnswer(result), 150);
  };

  const isConfirm = request.method === "confirm";
  const isSelect = request.method === "select";
  const isFreeform = request.method === "input" || request.method === "editor";

  return (
    <div className={`modal-backdrop${closing ? " is-closing" : ""}`}>
      <section className="request-dialog" role="dialog" aria-modal="true" aria-label={request.title ?? "Pi input"}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h2>{request.title ?? "Pi needs your input"}</h2>
            {request.message && <p>{request.message}</p>}
          </div>
          <IconButton label="Cancel" onClick={() => answer(undefined)}>
            <X size={16} />
          </IconButton>
        </header>

        {isSelect && (
          <div className="request-options">
            {request.options?.map((option) => (
              <button key={option} onClick={() => answer(option)}>{option}</button>
            ))}
          </div>
        )}

        {isFreeform && (
          request.method === "editor"
            ? <textarea
                autoFocus
                value={value}
                placeholder={request.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter submits even inside a multi-line editor
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    answer(value);
                  }
                }}
              />
            : <input
                autoFocus
                value={value}
                placeholder={request.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    answer(value);
                  }
                }}
              />
        )}

        <footer>
          <button className="secondary-button" onClick={() => answer(undefined)}>Cancel</button>
          {isConfirm && <button className="secondary-button" onClick={() => answer(false)}>No</button>}
          {(isConfirm || isFreeform) && (
            <button className="primary-button" onClick={() => answer(isConfirm ? true : value)}>
              {isConfirm ? "Yes" : "Continue"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
