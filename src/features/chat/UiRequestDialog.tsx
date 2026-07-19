import { useState } from "react";
import type { UiRequest } from "../../runtime/types";

export function UiRequestDialog({ request, onAnswer }: { request: UiRequest; onAnswer(value: string | boolean | undefined): void }) {
  const [value, setValue] = useState(request.prefill ?? "");
  return <div className="modal-backdrop"><section className="request-dialog" role="dialog" aria-modal="true">
    <h2>{request.title ?? "Pi needs your input"}</h2>{request.message && <p>{request.message}</p>}
    {request.method === "select" && <div className="request-options">{request.options?.map((option) => <button key={option} onClick={() => onAnswer(option)}>{option}</button>)}</div>}
    {["input", "editor"].includes(request.method) && (request.method === "editor" ? <textarea value={value} placeholder={request.placeholder} onChange={(e) => setValue(e.target.value)} /> : <input value={value} placeholder={request.placeholder} onChange={(e) => setValue(e.target.value)} />)}
    <footer><button className="secondary-button" onClick={() => onAnswer(undefined)}>Cancel</button>{request.method === "confirm" && <button className="secondary-button" onClick={() => onAnswer(false)}>No</button>}<button className="primary-button" onClick={() => onAnswer(request.method === "confirm" ? true : value)}>Continue</button></footer>
  </section></div>;
}
