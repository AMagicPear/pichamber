import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { isTauri, native } from "../../runtime/tauri";
import type { OpenFile, Project, TreeEntry } from "../../runtime/types";

const demoTree: TreeEntry[] = [
  { name: "src", path: "src", kind: "directory", children: [{ name: "App.tsx", path: "src/App.tsx", kind: "file" }, { name: "styles.css", path: "src/styles.css", kind: "file" }] },
  { name: "README.md", path: "README.md", kind: "file" },
  { name: "package.json", path: "package.json", kind: "file" },
];

function TreeNode({ entry, onFile }: { entry: TreeEntry; onFile(path: string): void }) {
  const [open, setOpen] = useState(true);
  if (entry.kind === "file") return <button className="tree-row" onClick={() => onFile(entry.path)}><span className="tree-indent" /><File size={14} /><span>{entry.name}</span></button>;
  return <div><button className="tree-row" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={14} /><span>{entry.name}</span></button>{open && <div className="tree-children">{entry.children?.map((child) => <TreeNode key={child.path} entry={child} onFile={onFile} />)}</div>}</div>;
}

export function Inspector({ project, file, onFile, onClose }: { project?: Project; file?: OpenFile; onFile(path: string): void; onClose(): void }) {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [tab, setTab] = useState<"files" | "file">(file ? "file" : "files");
  useEffect(() => { if (file) setTab("file"); }, [file]);
  useEffect(() => {
    if (!project) return;
    if (!isTauri()) { setTree(demoTree); return; }
    native.tree(project.path).then(setTree).catch(() => setTree([]));
  }, [project]);
  return <aside className="inspector">
    <div className="inspector-header"><div className="inspector-tabs"><button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>Files</button>{file && <button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}>{file.path.split("/").at(-1)}</button>}</div><IconButton label="Close inspector" onClick={onClose}><X size={16} /></IconButton></div>
    {tab === "files" ? <div className="file-tree">{tree.map((entry) => <TreeNode key={entry.path} entry={entry} onFile={onFile} />)}{tree.length === 0 && <div className="panel-empty">No files available</div>}</div>
      : file && <div className="file-view"><div className="file-path">{file.path}{file.truncated && <span>truncated</span>}</div><pre><code>{file.content}</code></pre></div>}
  </aside>;
}

