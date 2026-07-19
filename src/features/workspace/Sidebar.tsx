import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Archive, ChevronDown, FolderOpen, MoreHorizontal, PanelLeftClose, Plus, Search, Settings as SettingsIcon } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { listAllSessionsGrouped } from "../../api/client";
import type { PiSessionGroup } from "../../runtime/types";

interface Props {
  activeSessionPath: string | null;
  onOpenSession(sessionPath: string, cwd: string, title: string): void;
  onNewSession(cwd: string): void;
  onClose(): void;
  onSettings(): void;
}

// ── Helpers ─────────────────────────────────────────────────────────

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000], ["month", 2592000], ["day", 86400],
  ["hour", 3600], ["minute", 60], ["second", 1],
];

const rtf = new Intl.RelativeTimeFormat("en", { style: "narrow", numeric: "auto" });

function relativeTime(ts: number): string {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs || unit === "second") {
      return rtf.format(Math.round(-1 * diff / secs), unit);
    }
  }
  return "";
}

// ── Component ───────────────────────────────────────────────────────

export function Sidebar(props: Props) {
  const [groups, setGroups] = useState<PiSessionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLowerCase();

  const load = () => {
    setLoading(true);
    listAllSessionsGrouped()
      .then(setGroups)
      .catch((error) => console.warn("Failed to load Pi sessions:", error))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (searchOpen && inputRef.current) inputRef.current.focus(); }, [searchOpen]);

  const toggleProject = (cwd: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd); else next.add(cwd);
      return next;
    });
  };

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

  const hasSearch = normalized.length > 0;

  return (
    <aside className="sidebar" aria-label="Pi sessions">
      {/* ── Header row (OpenChamber-style) ── */}
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <IconButton label="Add project" className="tiny" onClick={load}>
            <FolderOpen size={15} />
          </IconButton>
          <IconButton label="New session" className="tiny" onClick={() => {
            const cwd = groups.length > 0 ? groups[0].cwd : "";
            if (cwd) props.onNewSession(cwd);
          }}>
            <Plus size={15} />
          </IconButton>
        </div>
        <div className="sidebar-header-actions">
          <IconButton
            label={searchOpen ? "Close search" : "Search sessions"}
            className={`tiny${searchOpen ? " is-active" : ""}`}
            onClick={() => {
              if (searchOpen) { setSearchOpen(false); setQuery(""); }
              else setSearchOpen(true);
            }}
          >
            <Search size={15} />
          </IconButton>
          <IconButton label="Hide sidebar" className="tiny" onClick={props.onClose}>
            <PanelLeftClose size={15} />
          </IconButton>
        </div>
      </div>

      {/* ── Expandable search (OpenChamber pattern) ── */}
      {searchOpen && (
        <div className="sidebar-search-group">
          <div className="sidebar-search-row">
            <Search size={14} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
              aria-label="Search sessions"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (hasSearch) setQuery(""); else { setSearchOpen(false); setQuery(""); }
                }
              }}
            />
            {hasSearch && (
              <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Clear">
                <span aria-hidden="true">&times;</span>
              </button>
            )}
          </div>
          {hasSearch && (
            <div className="sidebar-search-hint">
              {filtered.reduce((s, g) => s + g.sessions.length, 0)} matches · Esc to clear
            </div>
          )}
        </div>
      )}

      {/* ── Project list ── */}
      <div className="sidebar-projects">
        {loading && <div className="sidebar-empty">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div className="sidebar-empty">
            {normalized ? "No matching sessions." : "No sessions yet."}
          </div>
        )}
        {filtered.map((group) => {
          const isCollapsed = collapsed.has(group.cwd);
          return (
            <section className="project-section" key={group.cwd}>
              <div className={`project-header${!isCollapsed && group.sessions.length > 0 ? " is-expanded" : ""}`}>
                <button
                  className="project-toggle"
                  onClick={() => toggleProject(group.cwd)}
                  aria-label={isCollapsed ? "Expand" : "Collapse"}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button className="project-label" onClick={() => toggleProject(group.cwd)} title={group.cwd}>
                  <FolderOpen size={12} />
                  <span className="project-name">{group.name}</span>
                  <span className="project-cwd">{group.cwd}</span>
                </button>
                <div className="project-actions">
                  <IconButton label="New session" className="tiny" onClick={(e) => {
                    e.stopPropagation();
                    props.onNewSession(group.cwd);
                  }}>
                    <Plus size={13} />
                  </IconButton>
                </div>
              </div>
              {!isCollapsed && (
                <div className="session-list">
                  {group.sessions.length === 0 && (
                    <div className="session-empty">No sessions</div>
                  )}
                  {group.sessions.map((session) => {
                    const isActive = session.path === props.activeSessionPath;
                    const menuKey = `${group.cwd}:::${session.path}`;
                    const menuOpen = openMenuKey === menuKey;
                    return (
                      <div key={session.path} className={`session-row ${isActive ? "active" : ""}`}>
                        <span className={`session-dot${isActive ? " active" : ""}`} />
                        <button
                          className="session-main"
                          onClick={() =>
                            props.onOpenSession(session.path, group.cwd, session.name ?? session.id)
                          }
                        >
                          <span className="session-title">
                            <RenderHighlight
                              text={session.name ?? session.id.slice(0, 8)}
                              search={normalized}
                            />
                          </span>
                          <span className="session-time">
                            {relativeTime(session.modifiedAt)}
                          </span>
                        </button>
                        <div className="session-actions">
                          <div className="session-actions-inner">
                            <IconButton
                              label="More"
                              className="tiny"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuKey(menuOpen ? null : menuKey);
                              }}
                            >
                              <MoreHorizontal size={13} />
                            </IconButton>
                          </div>
                        </div>
                        {menuOpen && (
                          <div className="session-menu">
                            <button className="danger" onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuKey(null);
                              load();
                            }}>
                              <Archive size={12} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="sidebar-footer">
        <IconButton label="Settings" className="tiny" onClick={props.onSettings}>
          <SettingsIcon size={15} />
        </IconButton>
      </div>
    </aside>
  );
}

// ── Inline highlight helper ────────────────────────────────────────

function RenderHighlight({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(search);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + search.length)}</mark>
      {text.slice(idx + search.length)}
    </>
  );
}
