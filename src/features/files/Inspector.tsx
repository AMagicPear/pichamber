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
  width: number;
  panelRef: React.RefObject<HTMLElement | null>;
  resizeHandleRef: React.RefObject<HTMLDivElement | null>;
  resizeDragging: boolean;
  onResizeMouseDown(e: React.MouseEvent): void;
  onFile(path: string): void;
  onClose(): void;
}

function renderFiles(
  tab: Tab,
  file: OpenFile | undefined,
  tree: TreeEntry[],
  expanded: Record<string, boolean>,
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>,
  onFile: (path: string) => void,
) {
  if (tab !== "files") return null;
  const activePath: string | undefined = file ? file.path : undefined;
  if (file) return <FileView file={file} onBack={() => onFile("")} />;
  return <FileTreeView tree={tree} expanded={expanded} setExpanded={setExpanded} onOpen={onFile} activePath={activePath} />;
}

export function Inspector({ project, file, width, panelRef, resizeHandleRef, resizeDragging, onResizeMouseDown, onFile, onClose }: Props) {
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
    <aside
      ref={panelRef}
      className="inspector"
      aria-label="Inspector"
      style={{ "--inspector-w": `${width}px` } as React.CSSProperties}
    >
      <div
        ref={resizeHandleRef}
        className={`inspector-resize-handle${resizeDragging ? " is-dragging" : ""}`}
        onMouseDown={onResizeMouseDown}
      />
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
      <div className="inspector-body">
        {tab === "files" && renderFiles(tab, file, tree, expanded, setExpanded, onFile)}
        {tab === "context" && <ContextView project={project} />}
      </div>
    </aside>
  );
}

function FileView({ file, onBack }: { file: OpenFile; onBack(): void }) {
  return (
    <div className="file-view">
      <div className="file-path">
        <button type="button" onClick={onBack} aria-label="Back to tree">
          <Folder size={13} />
        </button>
        <span className="badge">{file.path.split("/").pop()}</span>
        <span className="file-path-text">{file.path}</span>
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
  activePath,
}: {
  tree: TreeEntry[];
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
  onOpen(path: string): void;
  activePath?: string;
}) {
  if (tree.length === 0) {
    return <div className="tree-empty">No files indexed for this project yet.</div>;
  }
  // Render as a flat list of rows with depth-driven indent + vertical guide lines,
  // mirroring OpenChamber's SidebarFilesTree tree-rendering pattern.
  const rows: Array<{ node: TreeEntry; depth: number; isLast: boolean; parentPath: string }> = [];
  const selectedPath: string | undefined = activePath;
  const walk = (nodes: TreeEntry[], depth: number, parentIsLast: boolean[], parentPath: string) => {
    nodes.forEach((node, index) => {
      const isLast = index === nodes.length - 1;
      rows.push({ node, depth, isLast, parentPath });
      const isDir = node.kind === "directory";
      const isOpen = expanded[node.path] ?? depth < 1;
      if (isDir && isOpen && node.children) {
        walk(node.children, depth + 1, [...parentIsLast, isLast], node.path);
      }
    });
  };
  walk(tree, 0, [], "");
  return (
    <div className="file-tree">
      {rows.map(({ node, depth, isLast }) => {
        const isDir = node.kind === "directory";
        const isOpen = expanded[node.path] ?? depth < 1;
        return (
          <div className="tree-row-wrap" key={node.path} style={{ paddingLeft: depth * 12 }}>
            {/* Indent guide lines (OpenChamber-style): a horizontal stub for every
                nested row + a vertical riser that bridges from the parent's
                vertical line down past the current row when it isn't the last
                child. The vertical riser is on the row's wrapping container so
                it spans the full row height without affecting the button's hit
                area. */}
            {depth > 0 && (
              <>
                <span
                  className="tree-guide-h"
                  style={{ left: depth * 12 - 7, width: 7 }}
                />
                {!isLast && (
                  <span
                    className="tree-guide-v"
                    style={{ left: depth * 12 - 7 }}
                  />
                )}
              </>
            )}
            <button
              className={`tree-row${selectedPath === node.path ? " active" : ""}`}
              onClick={() =>
                isDir
                  ? setExpanded((prev) => ({ ...prev, [node.path]: !isOpen }))
                  : onOpen(node.path)
              }
            >
              <span className="tree-icon" style={{ transform: isDir && isOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 140ms cubic-bezier(.22,1,.36,1)" }}>
                {isDir ? <ChevronRight size={12} /> : <File size={12} />}
              </span>
              <span>{node.name}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ContextView({ project }: { project?: Project }) {
  if (!project) {
    return <div className="panel-empty">Open a project to see context details.</div>;
  }
  return (
    <div className="context-panel">
      <div className="context-section">
        <div className="context-label">Project</div>
        <div className="context-value">{project.name}</div>
      </div>
      <div className="context-section">
        <div className="context-label">Working directory</div>
        <div className="context-value mono">{project.path}</div>
      </div>
      <div className="context-section">
        <div className="context-label">Runtime</div>
        <div className="context-value">Pi RPC over a per-session child process.</div>
      </div>
      <div className="context-section">
        <div className="context-label">Shortcuts</div>
        <div className="context-value">⌘K Command palette · ⌘B Toggle sidebar · Esc Stop · ⇧↩ Newline</div>
      </div>
    </div>
  );
}
