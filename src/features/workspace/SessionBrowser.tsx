import { useEffect, useMemo, useState } from "react";
import { Clock3, Search, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { listSessions } from "../../api/client";
import type { Project, SessionInfo } from "../../runtime/types";

const timeAgo = (seconds: number) => {
  const elapsed = Math.max(0, Date.now() - seconds * 1000);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
};

export function SessionBrowser({ project, onResume, onClose }: { project?: Project; onResume(session: SessionInfo): void; onClose(): void }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listSessions().then(setSessions).finally(() => setLoading(false));
  }, [project]);
  const filtered = useMemo(() => sessions.filter((session) => (!project || session.cwd === project.path) && `${session.name ?? ""} ${session.id}`.toLowerCase().includes(query.toLowerCase())), [sessions, project, query]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="session-browser" role="dialog" aria-modal="true" aria-label="Session history">
    <header><div><h2>Session history</h2><p>{project?.name ?? "All projects"}</p></div><IconButton label="Close history" onClick={onClose}><X size={17} /></IconButton></header>
    <div className="session-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" /></div>
    <div className="history-list">{loading && <div className="panel-empty">Loading sessions...</div>}{!loading && filtered.length === 0 && <div className="panel-empty">No matching Pi sessions</div>}{filtered.map((session) => <button key={session.path} className="history-row" onClick={() => onResume(session)}><span className="history-icon"><Clock3 size={15} /></span><span className="history-copy"><strong>{session.name || "Untitled session"}</strong><small>{session.messageCount} messages · {session.tokens.toLocaleString()} tokens</small></span><time>{timeAgo(session.modifiedAt)}</time></button>)}</div>
  </section></div>;
}
