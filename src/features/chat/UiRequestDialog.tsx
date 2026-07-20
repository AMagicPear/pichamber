import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { UiRequest } from "../../runtime/types";

export function UiRequestDialog({ request, onAnswer }: { request: UiRequest; onAnswer(value: string | boolean | undefined): void }) {
  const [value, setValue] = useState(request.prefill ?? "");
  // Reset the draft whenever the underlying request changes (e.g. a new
  // question comes in mid-turn).
  useEffect(() => { setValue(request.prefill ?? ""); }, [request.id, request.prefill]);

  const isConfirm = request.method === "confirm";
  const isSelect = request.method === "select";
  const isFreeform = request.method === "input" || request.method === "editor";

  return (
    <div className="modal-backdrop">
      <section className="request-dialog" role="dialog" aria-modal="true" aria-label={request.title ?? "Pi input"}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h2>{request.title ?? "Pi needs your input"}</h2>
            {request.message && <p>{request.message}</p>}
          </div>
          <IconButton label="Cancel" onClick={() => onAnswer(undefined)}>
            <X size={16} />
          </IconButton>
        </header>

        {isSelect && (
          <div className="request-options">
            {request.options?.map((option) => (
              <button key={option} onClick={() => onAnswer(option)}>{option}</button>
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
                    onAnswer(value);
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
                    onAnswer(value);
                  }
                }}
              />
        )}

        <footer>
          <button className="secondary-button" onClick={() => onAnswer(undefined)}>Cancel</button>
          {isConfirm && <button className="secondary-button" onClick={() => onAnswer(false)}>No</button>}
          {(isConfirm || isFreeform) && (
            <button className="primary-button" onClick={() => onAnswer(isConfirm ? true : value)}>
              {isConfirm ? "Yes" : "Continue"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
