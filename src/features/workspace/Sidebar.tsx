import { useMemo, useState } from "react";
import { FolderOpen, MoreHorizontal, PanelLeftClose, Pencil, Plus, Search, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { BrandMark } from "../../components/BrandLogo";
import { IconButton } from "../../components/IconButton";
import type { Project, SessionTab } from "../../runtime/types";

interface Props {
  projects: Project[];
  sessions: SessionTab[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  onOpenProject(): void;
  onNewSession(projectId: string): void;
  onSession(id: string): void;
  onClose(): void;
  onSettings(): void;
  onRename(session: SessionTab): void;
  onFork(session: SessionTab): void;
  onDelete(session: SessionTab): void;
  onRemoveProject(project: Project): void;
}

export function Sidebar(props: Props) {
  const [menu, setMenu] = useState<string>();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalized) return props.sessions;
    return props.sessions.filter((session) => session.title.toLowerCase().includes(normalized));
  }, [props.sessions, normalized]);

  return (
    <aside className="sidebar" aria-label="Projects and sessions">
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
        <IconButton label="Open project" className="tiny" onClick={props.onOpenProject}>
          <FolderOpen size={15} />
        </IconButton>
        <IconButton
          label="New session"
          className="tiny"
          onClick={() => {
            const target = props.projects.find((project) => project.id === props.activeProjectId) ?? props.projects[0];
            if (target) props.onNewSession(target.id);
          }}
          disabled={props.projects.length === 0}
        >
          <Plus size={15} />
        </IconButton>
        <span className="sidebar-header-spacer" />
        <IconButton label="Search sessions" className="tiny">
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
        {props.projects.length === 0 && (
          <div className="sidebar-empty">Open a project to start a Pi session.</div>
        )}
        {props.projects.map((project) => {
          const sessions = filtered.filter((session) => session.projectId === project.id);
          if (normalized && sessions.length === 0) return null;
          return (
            <section className="project-group" key={project.id}>
              <div className="project-row">
                <button className="project-name" title={project.path} onClick={() => props.onNewSession(project.id)}>
                  <FolderOpen size={12} />
                  <span>{project.name}</span>
                </button>
                <IconButton label={`New session in ${project.name}`} className="tiny" onClick={() => props.onNewSession(project.id)}>
                  <Plus size={14} />
                </IconButton>
                <IconButton label={`Remove ${project.name}`} className="tiny" onClick={() => props.onRemoveProject(project)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              <div className="session-list">
                {sessions.length === 0 && (
                  <div className="sidebar-empty" style={{ padding: "4px 10px" }}>No sessions yet.</div>
                )}
                {sessions.map((session) => (
                  <div key={session.id} className="session-row-wrap">
                    <button
                      className={`session-row ${props.activeSessionId === session.id ? "active" : ""}`}
                      onClick={() => props.onSession(session.id)}
                    >
                      <span className={`session-status ${session.running ? "running" : ""}`} />
                      <span className="session-title">{session.title}</span>
                      {session.unread && <span className="unread-dot" />}
                    </button>
                    <IconButton label={`Actions for ${session.title}`} className="tiny" onClick={() => setMenu(menu === session.id ? undefined : session.id)}>
                      <MoreHorizontal size={13} />
                    </IconButton>
                    {menu === session.id && (
                      <div className="session-menu">
                        <button onClick={() => { setMenu(undefined); props.onRename(session); }}>
                          <Pencil size={12} /> Rename
                        </button>
                        <button onClick={() => { setMenu(undefined); props.onFork(session); }}>
                          <GitForkIcon size={12} /> Fork
                        </button>
                        <div className="separator" />
                        <button className="danger" onClick={() => { setMenu(undefined); props.onDelete(session); }}>
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
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

function GitForkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="3" r="2" />
      <circle cx="6" cy="21" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M6 5v14" />
      <path d="M18 8v3a4 4 0 0 1-4 4H6" />
    </svg>
  );
}