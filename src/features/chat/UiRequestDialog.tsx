import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { RpcExtensionUIRequest } from "../../runtime/types";

/** Dialog for the four blocking UI methods Pi can ask for: `select`,
 *  `confirm`, `input`, `editor`. `notify` / `setStatus` / `setWidget` /
 *  `setTitle` / `set_editor_text` are handled elsewhere (toast, status bar,
 *  title) — see `use-pichamber.ts` event handler. */
export function UiRequestDialog({ request, onAnswer }: { request: RpcExtensionUIRequest; onAnswer(value: string | boolean | undefined): void }) {
  const isSelect = request.method === "select";
  const isConfirm = request.method === "confirm";
  const isInput = request.method === "input";
  const isEditor = request.method === "editor";
  const isFreeform = isInput || isEditor;

  // Dialog-specific accessors (Pi's `notify` / `setStatus` etc. don't reach
  // here — they're filtered out upstream).
  const title = (request as { title?: string }).title;
  const message = (request as { message?: string }).message;
  const placeholder = (request as { placeholder?: string }).placeholder;
  const options = isSelect ? request.options : [];
  const prefill = isEditor ? request.prefill : undefined;

  const [value, setValue] = useState(prefill ?? "");
  const [closing, setClosing] = useState(false);
  const answeringRef = useRef(false);

  useEffect(() => {
    setValue(prefill ?? "");
  }, [request.id, prefill]);

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

  return (
    <div className={`modal-backdrop${closing ? " is-closing" : ""}`}>
      <section className="request-dialog" role="dialog" aria-modal="true" aria-label={title ?? "Pi input"}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h2>{title ?? "Pi needs your input"}</h2>
            {message ? <p>{message}</p> : null}
          </div>
          <IconButton label="Cancel" onClick={() => answer(undefined)}>
            <X size={16} />
          </IconButton>
        </header>

        {isSelect && (
          <div className="request-options">
            {options.map((option) => (
              <button key={option} onClick={() => answer(option)}>{option}</button>
            ))}
          </div>
        )}

        {isFreeform && (
          isEditor
            ? <textarea
                autoFocus
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    answer(value);
                  }
                }}
              />
            : <input
                autoFocus
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); answer(value); }
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
