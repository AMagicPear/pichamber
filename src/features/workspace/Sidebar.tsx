import { Folder, GitFork, History, MoreHorizontal, PanelLeftClose, Pencil, Plus, Search, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
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
  onHistory(): void;
  onRename(session: SessionTab): void;
  onFork(session: SessionTab): void;
  onDelete(session: SessionTab): void;
  onRemoveProject(project: Project): void;
}

export function Sidebar(props: Props) {
  const [menu, setMenu] = useState<string>();
  return <aside className="sidebar" aria-label="Projects and sessions">
    <div className="sidebar-titlebar">
      <div aria-hidden data-tauri-drag-region="deep" className="drag-layer" />
      <div className="brand no-drag"><span className="brand-mark">π</span><span>Pichamber</span></div>
      <IconButton label="Hide sidebar" className="no-drag" onClick={props.onClose}><PanelLeftClose size={17} /></IconButton>
    </div>
    <div className="sidebar-actions">
      <button className="primary-action" onClick={props.onOpenProject}><Folder size={15} /> Open project</button>
      <IconButton label="Session history" onClick={props.onHistory}><History size={16} /></IconButton>
      <IconButton label="Search sessions" onClick={props.onHistory}><Search size={16} /></IconButton>
    </div>
    <div className="project-list">
      {props.projects.length === 0 && <div className="sidebar-empty">Open a project to start a Pi session.</div>}
      {props.projects.map((project) => <section className="project-group" key={project.id}>
        <div className="project-row">
          <button className="project-name" title={project.path}><Folder size={14} /> <span>{project.name}</span></button>
          <IconButton label={`New session in ${project.name}`} onClick={() => props.onNewSession(project.id)}><Plus size={15} /></IconButton>
          <IconButton label={`Remove ${project.name}`} onClick={() => props.onRemoveProject(project)}><Trash2 size={14} /></IconButton>
        </div>
        <div className="session-list">
          {props.sessions.filter((session) => session.projectId === project.id).map((session) =>
            <div key={session.id} className="session-row-wrap"><button className={`session-row ${props.activeSessionId === session.id ? "active" : ""}`} onClick={() => props.onSession(session.id)}>
              <span className={`session-status ${session.running ? "running" : ""}`} />
              <span className="session-title">{session.title}</span>
              {session.unread && <span className="unread-dot" />}
            </button><IconButton label={`Actions for ${session.title}`} onClick={() => setMenu(menu === session.id ? undefined : session.id)}><MoreHorizontal size={14} /></IconButton>{menu === session.id && <div className="session-menu"><button onClick={() => { setMenu(undefined); props.onRename(session); }}><Pencil size={13} /> Rename</button><button onClick={() => { setMenu(undefined); props.onFork(session); }}><GitFork size={13} /> Fork</button><button className="danger" onClick={() => { setMenu(undefined); props.onDelete(session); }}><Trash2 size={13} /> Delete</button></div>}</div>)}
        </div>
      </section>)}
    </div>
    <div className="sidebar-footer">
      <button className="sidebar-footer-button" onClick={props.onSettings}><Settings size={16} /> Settings</button>
      <span className="version">v0.1</span>
    </div>
  </aside>;
}

