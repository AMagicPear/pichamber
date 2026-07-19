import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ChevronRight, File, Folder, FolderTree, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { workspaceTree } from "../../api/client";
import type { OpenFile, Project, TreeEntry } from "../../runtime/types";

type Tab = "files" | "context";

interface Props {
  project?: Project;
  file?: OpenFile;
  onFile(path: string): void;
  onClose(): void;
}

export function Inspector({ project, file, onFile, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!project) { setTree([]); return; }
    const root = project.path;
    let cancelled = false;
    void workspaceTree(root, "", 4)
      .then((entries) => { if (!cancelled) setTree(entries as TreeEntry[]); })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // project is captured by root above so we re-fetch only on path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path]);

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-tabs">
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>
          <FolderTree size={13} /> Files
        </button>
        <button className={tab === "context" ? "active" : ""} onClick={() => setTab("context")}>
          <File size={13} /> Context
        </button>
        <span style={{ flex: 1 }} />
        <IconButton label="Close inspector" className="tiny" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {tab === "files" && (
        file
          ? <FileView file={file} onBack={() => onFile("")} />
          : <FileTreeView tree={tree} expanded={expanded} setExpanded={setExpanded} onOpen={onFile} />
      )}
      {tab === "context" && <ContextView project={project} />}
    </aside>
  );
}

function FileView({ file, onBack }: { file: OpenFile; onBack(): void }) {
  return (
    <div className="file-view">
      <div className="file-path">
        <button type="button" onClick={onBack} aria-label="Back to tree" style={{ background: "transparent", border: 0, padding: 0, color: "inherit", cursor: "pointer" }}>
          <Folder size={13} />
        </button>
        <span className="badge">{file.path.split("/").pop()}</span>
        <span>{file.path}</span>
      </div>
      <pre>{file.content}{file.truncated ? "\n\n… truncated" : ""}</pre>
    </div>
  );
}

function FileTreeView({
  tree,
  expanded,
  setExpanded,
  onOpen,
}: {
  tree: TreeEntry[];
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  onOpen(path: string): void;
}) {
  if (tree.length === 0) {
    return <div className="tree-empty">No files indexed for this project yet.</div>;
  }
  return (
    <div className="file-tree">
      {tree.map((node) => (
        <TreeRow key={node.path} node={node} depth={0} expanded={expanded} setExpanded={setExpanded} onOpen={onOpen} />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  setExpanded,
  onOpen,
}: {
  node: TreeEntry;
  depth: number;
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  onOpen(path: string): void;
}) {
  const isDir = node.kind === "directory";
  const isOpen = expanded[node.path] ?? depth < 1;
  return (
    <div>
      <button
        className="tree-row"
        onClick={() => (isDir ? setExpanded({ ...expanded, [node.path]: !isOpen }) : onOpen(node.path))}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {isDir ? (
          <span className="tree-icon" style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 140ms cubic-bezier(.22,1,.36,1)" }}>
            <ChevronRight size={12} />
          </span>
        ) : (
          <span className="tree-icon"><File size={12} /></span>
        )}
        <span>{node.name}</span>
      </button>
      {isDir && isOpen && node.children?.map((child) => (
        <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded} setExpanded={setExpanded} onOpen={onOpen} />
      ))}
    </div>
  );
}

function ContextView({ project }: { project?: Project }) {
  if (!project) {
    return <div className="panel-empty">Open a project to see context details.</div>;
  }
  return (
    <div className="context-panel">
      <div className="context-row">
        <strong>Project</strong>
        <small>{project.name}</small>
      </div>
      <div className="context-row">
        <strong>Working directory</strong>
        <small style={{ fontFamily: "var(--font-mono)" }}>{project.path}</small>
      </div>
      <div className="context-row">
        <strong>Runtime</strong>
        <small>Pi RPC over a per-session child process.</small>
      </div>
      <div className="context-row">
        <strong>Shortcuts</strong>
        <small>⌘K command palette · ⌘N new session · ⇧↩ newline</small>
      </div>
    </div>
  );
}