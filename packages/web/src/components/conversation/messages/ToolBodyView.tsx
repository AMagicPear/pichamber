import { defineComponent, type PropType } from "vue";
import type { VNode } from "vue";
import FilePathLabel from "@/components/ui/FilePathLabel.vue";
import MarkdownRender from "markstream-vue";
import CodeView from "../../ui/CodeView.vue";
import DiffView from "../../panels/DiffView.vue";
import ImageThumbnail from "../../ui/ImageThumbnail.vue";
import { displayPath } from "./toolDiff";
import { type ToolBody } from "./toolBody";
import { useMarkdownRender } from "./useMarkdownRender";
import { i18n } from "@/i18n";
import "./ToolBodyView.css";

// 模块级工具结果解析文本也走 i18n（不依赖组件上下文）。
const gt = (key: string, params?: Record<string, unknown>) =>
  params ? i18n.global.t(key, params) : i18n.global.t(key);

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
  itemsClass?: string;
  notes: string[];
  rows: VNode[];
};

type PathStats = { added: number; removed: number };

/** Pi appends its truncation notice as a standalone bracketed line. Keep it
 * out of the result body so both structured lists and shell output can show
 * the full-output location as a quiet footnote. */
const TRUNCATION_NOTE = /^\[(?:Truncated: .+|Showing (?:lines|last) .+\. Full output: .+)\]$/;

const splitTruncationNotes = (output: string): { lines: string[]; notes: string[] } => {
  const raw = output.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  const notes: string[] = [];
  for (const line of raw) {
    if (TRUNCATION_NOTE.test(line)) notes.push(line);
    else lines.push(line);
  }
  return { lines, notes };
};

const renderListRows = (output: string, stats?: Record<string, PathStats>): ListRows => {
  const { lines, notes } = splitTruncationNotes(output);
  const items = lines.filter((l) => l.length > 0).map(displayPath);
  return {
    heading: items.length === 0 ? gt('toolBody.noFiles') : gt('toolBody.nFiles', { count: items.length }),
    empty: gt('toolBody.noFiles'),
    itemsClass: "tool-body-view__list-items--flow",
    notes,
    rows: items.map((name) => (
      <li class="tool-body-view__list-row" key={name}>
        <FilePathLabel class="tool-body-view__list-name" path={name} showPrefix />
        {stats?.[name] && (
          <span class="tool-body-view__list-stats">
            <span class="tool-body-view__list-stat-add">+{stats[name].added}</span>
            <span class="tool-body-view__list-stat-remove">-{stats[name].removed}</span>
          </span>
        )}
      </li>
    )),
  };
};

const renderGrepRows = (output: string): ListRows => {
  const { lines, notes } = splitTruncationNotes(output);
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
    heading: matches.length === 0 ? gt('toolBody.noMatches') : gt('toolBody.nMatches', { count: matches.length }),
    empty: gt('toolBody.noMatches'),
    itemsClass: "tool-body-view__list-items--matches",
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
  const parsed = body.kind === "grep" ? renderGrepRows(body.output) : renderListRows(body.output, body.stats);
  return (
    <div class="tool-body-view__list">
      <div class="tool-body-view__list-heading">{parsed.heading}</div>
      {parsed.rows.length > 0 ? (
        <ul class={["tool-body-view__list-items", parsed.itemsClass]}>{parsed.rows}</ul>
      ) : (
        <p class="tool-body-view__list-empty">{parsed.empty}</p>
      )}
      {parsed.notes.length > 0 && (
        <p class="tool-body-view__list-notes">{parsed.notes.join(" · ")}</p>
      )}
    </div>
  );
};

const ToolBodyView = defineComponent({
  name: "ToolBodyView",
  props: {
    body: { type: Object as PropType<ToolBody>, required: true },
    final: { type: Boolean, default: true },
  },
  setup(props) {
    const markdownRenderProps = useMarkdownRender(() => props.final);

    return () => {
      const body = props.body;
      switch (body.kind) {
        case "markdown":
          return <MarkdownRender class="markdown-chat tool-body-view__markdown" {...markdownRenderProps.value} content={body.content} />;
        case "diff":
          return <DiffView class="tool-body-view__diff" patch={body.patch} />;
        case "images":
          return (
            <div class="tool-body-view__images">
              {body.images.map((img, i) => (
                <ImageThumbnail
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={gt('toolBody.readImage')}
                  variant="tool"
                />
              ))}
            </div>
          );
        case "code":
          return <CodeView class="tool-body-view__code" content={body.content} fileName={body.fileName} />;
        case "text":
          {
            const { lines, notes } = splitTruncationNotes(body.content);
            return (
              <>
                <pre class="tool-body-view__text">{lines.join("\n")}</pre>
                {notes.length > 0 && <p class="tool-body-view__text-notes">{notes.join(" · ")}</p>}
              </>
            );
          }
        case "grep":
        case "paths":
          return listBody(body);
      }
    };
  },
});

export default ToolBodyView;
