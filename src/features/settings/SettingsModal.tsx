import { useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import type { ThinkingLevel } from "../../runtime/types";

export function SettingsModal({ theme, thinkingLevel, piPath, onTheme, onThinking, onPiPath, onClose }: { theme: string; thinkingLevel: ThinkingLevel; piPath: string; onTheme(value: "light" | "dark" | "system"): void; onThinking(value: ThinkingLevel): void; onPiPath(value: string): void; onClose(): void }) {
  const [draftTheme, setDraftTheme] = useState(theme as "light" | "dark" | "system");
  const [draftThinking, setDraftThinking] = useState(thinkingLevel);
  const [draftPiPath, setDraftPiPath] = useState(piPath);
  const apply = () => { onTheme(draftTheme); onThinking(draftThinking); onPiPath(draftPiPath.trim()); onClose(); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
      <header><div><h2>Settings</h2><p>Configure the desktop shell and Pi defaults.</p></div><IconButton label="Close settings" onClick={onClose}><X size={18} /></IconButton></header>
      <div className="settings-layout"><nav><button className="active">General</button></nav><div className="settings-content">
        <h3>General</h3>
        <label className="setting-row"><span><strong>Appearance</strong><small>Choose how Pichamber looks.</small></span><select value={draftTheme} onChange={(event) => setDraftTheme(event.target.value as "light" | "dark" | "system")}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label className="setting-row"><span><strong>Default thinking</strong><small>Applied to new Pi sessions.</small></span><select value={draftThinking} onChange={(event) => setDraftThinking(event.target.value as ThinkingLevel)}>{["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="setting-row"><span><strong>Pi runtime</strong><small>Leave empty to discover Pi automatically.</small></span><input value={draftPiPath} onChange={(event) => setDraftPiPath(event.target.value)} placeholder="/path/to/pi" /></label>
        <footer className="settings-footer"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={apply}>Apply changes</button></footer>
      </div></div>
    </section>
  </div>;
}

