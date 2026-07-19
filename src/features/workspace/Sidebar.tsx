import { useEffect, useMemo, useState } from "react";
import { FolderOpen, PanelLeftClose, Plus, RefreshCw, Search, Settings as SettingsIcon } from "lucide-react";
import { BrandMark } from "../../components/BrandLogo";
import { IconButton } from "../../components/IconButton";
import { isTauri, native, openProject } from "../../runtime/tauri";
import type { PiSessionGroup } from "../../runtime/types";

interface Props {
  onOpenSession(sessionPath: string, cwd: string, title: string): void;
  onNewSession(cwd: string): void;
  onClose(): void;
  onSettings(): void;
}

export function Sidebar(props: Props) {
  const [groups, setGroups] = useState<PiSessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();

  const load = () => {
    if (!isTauri()) return;
    setLoading(true);
    native
      .listAllSessionsGrouped()
      .then(setGroups)
      .catch((error) => console.warn("Failed to load Pi sessions:", error))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!normalized) return groups;
    return groups
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter(
          (session) =>
            (session.name ?? "").toLowerCase().includes(normalized) ||
            session.id.toLowerCase().includes(normalized) ||
            group.name.toLowerCase().includes(normalized),
        ),
      }))
      .filter((group) => group.sessions.length > 0);
  }, [groups, normalized]);

  return (
    <aside className="sidebar" aria-label="Pi sessions">
      <div className="sidebar-titlebar">
        <div aria-hidden data-tauri-drag-region="deep" className="drag-layer" />
        <div className="brand no-drag">
          <BrandMark size={22} />
          <span>Pichamber</span>
        </div>
        <IconButton label="Hide sidebar" className="no-drag tiny" onClick={props.onClose}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      <div className="sidebar-header-row no-drag">
        <IconButton label="Add project directory" className="tiny" onClick={() => {
          openProject().then((project) => {
            if (project) { load(); }
          });
        }}>
          <FolderOpen size={15} />
        </IconButton>
        <IconButton label="Refresh sessions" className="tiny" onClick={load}>
          <RefreshCw size={15} />
        </IconButton>
        <span className="sidebar-header-spacer" />
        <IconButton label="Search" className="tiny">
          <Search size={15} />
        </IconButton>
      </div>

      <div className="sidebar-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
      </div>

      <div className="project-list no-drag">
        {loading && <div className="sidebar-empty">Loading Pi sessions…</div>}
        {!loading && filtered.length === 0 && (
          <div className="sidebar-empty">
            {normalized ? "No matching sessions." : "No Pi sessions yet. Open a project folder to start."}
          </div>
        )}
        {filtered.map((group) => (
          <section className="project-group" key={group.cwd}>
            <div className="project-row">
              <button
                className="project-name"
                title={group.cwd}
                onClick={() => props.onNewSession(group.cwd)}
              >
                <FolderOpen size={12} />
                <span>{group.name}</span>
              </button>
              <IconButton
                label={`New session in ${group.name}`}
                className="tiny"
                onClick={() => props.onNewSession(group.cwd)}
              >
                <Plus size={14} />
              </IconButton>
            </div>
            <div className="session-list">
              {group.sessions.map((session) => (
                <button
                  key={session.path}
                  className="session-row"
                  onClick={() =>
                    props.onOpenSession(session.path, group.cwd, session.name ?? session.id)
                  }
                >
                  <span className="session-title">
                    {session.name ?? session.id.slice(0, 8)}
                  </span>
                  <span className="session-meta">
                    {session.messageCount > 0 && `${session.messageCount} msg`}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="sidebar-footer no-drag">
        <IconButton label="Settings" className="tiny" onClick={props.onSettings}>
          <SettingsIcon size={16} />
        </IconButton>
        <span className="sidebar-version">v0.1</span>
      </div>
    </aside>
  );
}
