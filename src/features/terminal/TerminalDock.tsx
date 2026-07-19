import { useEffect, useRef, useState } from "react";
import { Maximize2, Plus, RotateCw, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { IconButton } from "../../components/IconButton";
import { isTauri, native } from "../../runtime/tauri";

export function TerminalDock({ cwd, onClose }: { cwd?: string; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "closed" | "error">("connecting");
  const [restart, setRestart] = useState(0);
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!host.current || !cwd) { setStatus("closed"); return; }
    const terminal = new Terminal({
      cursorBlink: true, fontSize: 13, lineHeight: 1.35,
      fontFamily: "var(--font-mono)", theme: { background: "#171816", foreground: "#d6d7d2", cursor: "#d9a441", selectionBackground: "#4a4d47" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit); terminal.open(host.current); fit.fit(); terminalRef.current = terminal;
    let ptyId: string | undefined;
    let disposed = false;
    let unlisten: Array<() => void> = [];
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { fit.fit(); if (ptyId) void native.resizePty(ptyId, terminal.cols, terminal.rows); });
    });
    observer.observe(host.current);
    if (!isTauri()) {
      terminal.writeln("\x1b[38;5;214mPichamber demo terminal\x1b[0m");
      terminal.write(`\r\n${cwd} $ `); setStatus("ready");
      const input = terminal.onData((data) => { if (data === "\r") terminal.write(`\r\n${cwd} $ `); else terminal.write(data); });
      return () => { input.dispose(); observer.disconnect(); cancelAnimationFrame(resizeFrame); terminal.dispose(); };
    }
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = [
          await listen<{ ptyId: string; data: string }>("pty-data", (event) => { if (event.payload.ptyId === ptyId) terminal.write(event.payload.data); }),
          await listen<{ ptyId: string }>("pty-exit", (event) => { if (event.payload.ptyId === ptyId) setStatus("closed"); }),
        ];
        const result = await native.startPty(cwd, terminal.cols, terminal.rows);
        if (disposed) { await native.stopPty(result.ptyId); return; }
        ptyId = result.ptyId; setStatus("ready");
        terminal.onData((data) => { if (ptyId) void native.writePty(ptyId, data); });
      } catch (error) { terminal.writeln(`\r\nTerminal failed: ${String(error)}`); setStatus("error"); }
    })();
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(resizeFrame); unlisten.forEach((fn) => fn()); if (ptyId) void native.stopPty(ptyId); terminal.dispose(); terminalRef.current = null; };
  }, [cwd, restart]);
  return <section className={`terminal-dock ${maximized ? "maximized" : ""}`}>
    <header><div className="terminal-tabs"><button className="active">Terminal</button><IconButton label="New terminal" onClick={() => setRestart((value) => value + 1)}><Plus size={14} /></IconButton></div><div className="terminal-actions"><span className={`terminal-status ${status}`}>{status}</span>{["closed", "error"].includes(status) && <IconButton label="Restart terminal" onClick={() => setRestart((value) => value + 1)}><RotateCw size={14} /></IconButton>}<IconButton label={maximized ? "Restore terminal" : "Maximize terminal"} onClick={() => setMaximized(!maximized)}><Maximize2 size={14} /></IconButton><IconButton label="Close terminal" onClick={onClose}><X size={15} /></IconButton></div></header>
    <div className="terminal-host" ref={host}>{!cwd && <div className="panel-empty">Open a project to start a terminal.</div>}</div>
  </section>;
}

