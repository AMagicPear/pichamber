import { useEffect, useRef, useState } from "react";
import { Maximize2, Plus, RotateCw, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { IconButton } from "../../components/IconButton";
import { ptyWs, startPty } from "../../api/client";

type Status = "connecting" | "ready" | "closed" | "error";

const theme = {
  background: "#171816",
  foreground: "#d6d7d2",
  cursor: "#d9a441",
  selectionBackground: "#4a4d47",
};

export function TerminalDock({ cwd, onClose }: { cwd?: string; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [restart, setRestart] = useState(0);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!host.current || !cwd) { setStatus("closed"); return; }

    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, lineHeight: 1.35, fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace', theme });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    fit.fit();
    terminalRef.current = terminal;

    let ptyId: string | undefined;
    let ws: WebSocket | null = null;
    let disposed = false;
    let resizeFrame = 0;

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        fit.fit();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        }
      });
    });
    observer.observe(host.current);

    const cleanup = () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      if (ws) { ws.onclose = null; ws.onmessage = null; ws.close(); }
      terminal.dispose();
      terminalRef.current = null;
    };

    void (async () => {
      try {
        const result = await startPty({ cwd, cols: terminal.cols, rows: terminal.rows });
        if (disposed) return;
        ptyId = result.ptyId;

        ws = ptyWs(ptyId);
        ws.onmessage = (event) => {
          if (typeof event.data === "string") terminal.write(event.data);
        };
        ws.onclose = () => {
          if (!disposed) setStatus("closed");
        };
        ws.onerror = () => {
          // onclose fires next
        };

        // Wait for WS to open before setting ready
        await new Promise<void>((resolve) => {
          if (!ws) return resolve();
          if (ws.readyState === WebSocket.OPEN) return resolve();
          ws.onopen = () => resolve();
        });

        if (disposed) return;
        setStatus("ready");

        terminal.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
        });
      } catch (error) {
        if (!disposed) {
          terminal.writeln(`\r\nTerminal failed: ${String(error)}`);
          setStatus("error");
        }
      }
    })();

    return cleanup;
  }, [cwd, restart]);

  const restartTerminal = () => setRestart((value) => value + 1);
  const showRestart = status === "closed" || status === "error";

  return <section className={`terminal-dock ${maximized ? "maximized" : ""}`}>
    <header>
      <div className="terminal-tabs"><button className="active">Terminal</button><IconButton label="New terminal" onClick={restartTerminal}><Plus size={14} /></IconButton></div>
      <div className="terminal-actions">
        <span className={`terminal-status ${status}`}>{status}</span>
        {showRestart && <IconButton label="Restart terminal" onClick={restartTerminal}><RotateCw size={14} /></IconButton>}
        <IconButton label={maximized ? "Restore terminal" : "Maximize terminal"} onClick={() => setMaximized(!maximized)}><Maximize2 size={14} /></IconButton>
        <IconButton label="Close terminal" onClick={onClose}><X size={15} /></IconButton>
      </div>
    </header>
    <div className="terminal-host" ref={host}>{!cwd && <div className="panel-empty">Open a project to start a terminal.</div>}</div>
  </section>;
}
