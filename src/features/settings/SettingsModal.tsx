import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { useDialogDismiss } from "../../hooks/useDialogDismiss";
import type { ThinkingLevel } from "../../runtime/types";

type Section = "general" | "runtime" | "shortcuts";

const SECTIONS: Array<{ id: Section; label: string; description: string }> = [
  { id: "general", label: "General", description: "Appearance and defaults." },
  { id: "runtime", label: "Runtime", description: "How Pichamber talks to Pi." },
  { id: "shortcuts", label: "Shortcuts", description: "Keybindings used in this window." },
];

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function SettingsModal({
  theme,
  thinkingLevel,
  piPath,
  onTheme,
  onThinking,
  onPiPath,
  onClose,
}: {
  theme: string;
  thinkingLevel: ThinkingLevel;
  piPath: string;
  onTheme(value: "light" | "dark" | "system"): void;
  onThinking(value: ThinkingLevel): void;
  onPiPath(value: string): void;
  onClose(): void;
}) {
  const { closing, dismiss } = useDialogDismiss(onClose);
  const [section, setSection] = useState<Section>("general");
  const [draftTheme, setDraftTheme] = useState(theme as "light" | "dark" | "system");
  const [draftThinking, setDraftThinking] = useState(thinkingLevel);
  const [draftPiPath, setDraftPiPath] = useState(piPath);

  // Re-sync drafts when the modal is re-opened with new values
  useEffect(() => { setDraftTheme(theme as "light" | "dark" | "system"); }, [theme]);
  useEffect(() => { setDraftThinking(thinkingLevel); }, [thinkingLevel]);
  useEffect(() => { setDraftPiPath(piPath); }, [piPath]);

  // Esc closes the modal at the document level so the user doesn't have to
  // click outside or hit the X button.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dismiss]);

  const apply = () => {
    const trimmedPath = draftPiPath.trim();
    onTheme(draftTheme);
    onThinking(draftThinking);
    if (trimmedPath !== piPath) onPiPath(trimmedPath);
    toast.success("Settings saved");
    dismiss();
  };

  const dirty =
    draftTheme !== theme ||
    draftThinking !== thinkingLevel ||
    draftPiPath.trim() !== piPath;

  return (
    <div
      className={`modal-backdrop${closing ? " is-closing" : ""}`}
      role="presentation"
      onMouseDown={(event) => { if (event.currentTarget === event.target) dismiss(); }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <header>
          <div>
            <h2>Settings</h2>
            <p>Configure the browser shell and Pi defaults.</p>
          </div>
          <IconButton label="Close settings" onClick={dismiss}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="settings-layout">
          <nav aria-label="Settings sections">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                className={section === item.id ? "active" : ""}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {section === "general" && (
              <>
                <h3>General</h3>
                <label className="setting-row">
                  <span>
                    <strong>Appearance</strong>
                    <small>Choose how Pichamber looks.</small>
                  </span>
                  <select
                    value={draftTheme}
                    onChange={(event) => setDraftTheme(event.target.value as "light" | "dark" | "system")}
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <label className="setting-row">
                  <span>
                    <strong>Default thinking</strong>
                    <small>Applied to new Pi sessions.</small>
                  </span>
                  <select
                    value={draftThinking}
                    onChange={(event) => setDraftThinking(event.target.value as ThinkingLevel)}
                  >
                    {THINKING_LEVELS.map((value) => (
                      <option key={value} value={value}>
                        {value.charAt(0).toUpperCase() + value.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {section === "runtime" && (
              <>
                <h3>Runtime</h3>
                <label className="setting-row">
                  <span>
                    <strong>Pi binary</strong>
                    <small>Leave empty to discover Pi automatically.</small>
                  </span>
                  <input
                    value={draftPiPath}
                    onChange={(event) => setDraftPiPath(event.target.value)}
                    placeholder="/path/to/pi"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
              </>
            )}

            {section === "shortcuts" && (
              <>
                <h3>Shortcuts</h3>
                <div className="setting-row">
                  <span>
                    <strong>Command palette</strong>
                    <small>Open the quick-action search.</small>
                  </span>
                  <kbd>⌘K</kbd>
                </div>
                <div className="setting-row">
                  <span>
                    <strong>Send message</strong>
                    <small>Submit the composer prompt.</small>
                  </span>
                  <kbd>Enter</kbd>
                </div>
                <div className="setting-row">
                  <span>
                    <strong>Newline in composer</strong>
                    <small>Insert a line break without sending.</small>
                  </span>
                  <kbd>Shift</kbd>+<kbd>Enter</kbd>
                </div>
                <div className="setting-row">
                  <span>
                    <strong>Toggle sidebar</strong>
                    <small>Show or hide the session list.</small>
                  </span>
                  <kbd>⌘B</kbd>
                </div>
              </>
            )}

            <footer className="settings-footer">
              <button className="secondary-button" onClick={dismiss}>Cancel</button>
              <button
                className="primary-button"
                onClick={apply}
                disabled={!dirty && section !== "general" && section !== "runtime"}
              >
                Apply changes
              </button>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
