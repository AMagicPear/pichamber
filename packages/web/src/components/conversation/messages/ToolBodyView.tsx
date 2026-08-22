import { defineComponent, type PropType, type FunctionalComponent, type SVGAttributes } from "vue";
import type { VNode } from "vue";
// vite-svg-loader turns each .svg into a Vue component at build time, but the
// bare `*.svg` module type here is `string`; cast to the component contract so
// the JSX/<FolderIcon/> usage type-checks.
import FolderIconSrc from "lucide-static/icons/folder.svg";
import FileTextIconSrc from "@/assets/icons/FileText.svg";
import { getEntryIcon } from "../../ui/fileIcon";
import CodeView from "../../ui/CodeView.vue";
import DiffView from "../../panels/DiffView.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import { displayPath } from "./toolDiff";
import { type ToolBody } from "./toolBody";
import "./ToolBodyView.css";

const FolderIcon = FolderIconSrc as unknown as FunctionalComponent<SVGAttributes>;
const FileTextIcon = FileTextIconSrc as unknown as FunctionalComponent<SVGAttributes>;

/* ── Tool-result body renderer (TSX) ─────────────────────────────
 *
 * The expanded body of a tool result — every `ToolBody` kind is rendered
 * here in one place, so what the raw `ls`/`grep`/find output turns into on
 * screen (parse → heading → rows/empty → notes) is decided and mounted in
 * the same component, not split across an external `toolBody.ts` data
 * station plus a template.  `markdown` / `diff` / `images` / `code` / `text`
 * are simple passthroughs; the three structured-list kinds share one card
 * shell with per-kind row renderers.
 */

type ListRows = {
  heading: string;
  empty: string;
  /** Classes appended to the `<ul>` (grep rows use a wider gap). */
  itemsClass: string;
  notes: string[];
  rows: VNode[];
};

/** Pi appends truncation/limit notices as bracketed lines like
 *  `[Truncated: 50 entries limit]`. Split them off so the structured lists
 *  show only real entries; the notes are rendered as a muted footnote. */
const splitNotes = (output: string): { lines: string[]; notes: string[] } => {
  const raw = output.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  const notes: string[] = [];
  for (const line of raw) {
    if (line.startsWith("[") && line.endsWith("]")) notes.push(line);
    else lines.push(line);
  }
  return { lines, notes };
};

const isDirName = (name: string) => name.endsWith("/");

/** List row leading icon: catppuccin sprite when one exists for the name,
 *  otherwise the Folder/FileText glyph. `fileFallback` toggles whether a
 *  bare file line gets the generic file icon. */
const rowIcon = (name: string, isDir: boolean, fileFallback: boolean) => {
  const icon = getEntryIcon(name, isDir, false);
  if (icon) {
    return (
      <svg class="tool-body-view__list-icon" aria-hidden="true">
        <use href={icon} />
      </svg>
    );
  }
  if (isDir) return <FolderIcon class="tool-body-view__list-icon" aria-hidden="true" />;
  if (fileFallback) return <FileTextIcon class="tool-body-view__list-icon" aria-hidden="true" />;
  return null;
};

const renderListRows = (output: string): ListRows => {
  const { lines, notes } = splitNotes(output);
  const items = lines.filter((l) => l.length > 0).map(displayPath);
  return {
    heading: items.length === 0 ? "no files" : `${items.length} files`,
    empty: "No files",
    itemsClass: " tool-body-view__list-items--flow",
    notes,
    rows: items.map((name) => (
      <li class="tool-body-view__list-row" key={name}>
        {rowIcon(name, isDirName(name), true)}
        <span class="tool-body-view__list-name">{name}</span>
      </li>
    )),
  };
};

const renderGrepRows = (output: string): ListRows => {
  const { lines, notes } = splitNotes(output);
  const matches: { file: string; line: number; text: string }[] = [];
  for (const line of lines) {
    // ripgrep convention: <path>:<line>:<text>. The matched line can itself
    // contain ":", so split on the first two colons.
    const first = line.indexOf(":");
    if (first <= 0) continue;
    const second = line.indexOf(":", first + 1);
    if (second <= 0) continue;
    const file = displayPath(line.slice(0, first));
    const num = Number.parseInt(line.slice(first + 1, second), 10);
    if (!Number.isFinite(num)) continue;
    matches.push({ file, line: num, text: line.slice(second + 1) });
  }
  return {
    heading: matches.length === 0 ? "no matches" : `${matches.length} matches`,
    empty: "No matches",
    itemsClass: " tool-body-view__list-items--matches",
    notes,
    rows: matches.map((m) => (
      <li class="tool-body-view__match" key={`${m.file}:${m.line}`}>
        <span class="tool-body-view__match-path">{m.file}</span>
        <span class="tool-body-view__match-line">{m.line}</span>
        <span class="tool-body-view__match-text">{m.text}</span>
      </li>
    )),
  };
};

const listBody = (body: Extract<ToolBody, { kind: "grep" | "paths" }>) => {
  const parsed = body.kind === "grep" ? renderGrepRows(body.output) : renderListRows(body.output);
  return (
    <div class="tool-body-view__list">
      <div class="tool-body-view__list-heading">{parsed.heading}</div>
      {parsed.rows.length > 0 ? (
        <ul class={`tool-body-view__list-items${parsed.itemsClass}`}>{parsed.rows}</ul>
      ) : (
        <p class="tool-body-view__list-empty">{parsed.empty}</p>
      )}
      {parsed.notes.length > 0 && (
        <p class="tool-body-view__list-notes">{parsed.notes.join(" · ")}</p>
      )}
    </div>
  );
};

export const ToolBodyView = defineComponent({
  name: "ToolBodyView",
  props: { body: { type: Object as PropType<ToolBody>, required: true } },
  setup(props) {
    return () => {
      const body = props.body;
      switch (body.kind) {
        case "markdown":
          return <ChatMarkdown class="tool-body-view__markdown" content={body.content} />;
        case "diff":
          return <DiffView class="tool-body-view__diff" patch={body.patch} />;
        case "images":
          return (
            <div class="tool-body-view__images">
              {body.images.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="Read image"
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
          );
        case "code":
          return <CodeView content={body.content} fileName={body.fileName} />;
        case "text":
          return <pre class="tool-body-view__text">{body.content}</pre>;
        case "grep":
        case "paths":
          return listBody(body);
      }
    };
  },
});

export default ToolBodyView;
