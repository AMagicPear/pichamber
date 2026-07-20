import { useEffect, useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { Markdown } from "../../components/Markdown";

const SUMMARY_MAX_CHARS = 80;

/**
 * Strip common markdown syntax so the header preview reads as plain text.
 * Mirrors OpenChamber's `ReasoningPart.stripMarkdown` — fenced code, inline
 * code, bold/italic, headings, links, blockquote markers, hrules.
 */
const stripMarkdown = (text: string): string =>
  text
    .replace(/<!--\s*-->/g, "")
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, inner: string) => inner.trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .trim();

const getSummary = (text: string): string => {
  if (!text) return "";
  const flat = stripMarkdown(text).replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_MAX_CHARS) return flat;
  const cut = flat.lastIndexOf(" ", SUMMARY_MAX_CHARS);
  const end = cut > 0 ? cut : SUMMARY_MAX_CHARS;
  return `${flat.substring(0, end).trimEnd()}…`;
};

/** Strip leading blockquote markers and drop empty lines — keeps streamed
 *  reasoning tight as it accumulates. */
const cleanReasoning = (text: string): string => {
  if (typeof text !== "string") return "";
  return text
    .split("\n")
    .map((line) => line.replace(/^>\s?/, "").trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
};

interface ThinkingBlockProps {
  text: string;
  /** True while the upstream model is still streaming the reasoning content.
   *  Controls auto-expand + the trailing BusyDots. */
  streaming?: boolean;
  /** Stable identity for the row, used in ARIA controls. */
  blockId?: string;
}

export function ThinkingBlock({ text, streaming = false, blockId }: ThinkingBlockProps) {
  const cleaned = useMemo(() => cleanReasoning(text), [text]);
  const summary = useMemo(() => getSummary(cleaned), [cleaned]);

  // Auto-expand while streaming, collapse once the run is over. The user can
  // override the auto state by clicking the row (source="user" wins).
  const [expansion, setExpansion] = useState<{ expanded: boolean; source: "auto" | "user" }>(
    () => ({ expanded: streaming, source: "auto" }),
  );
  const isExpanded = expansion.source === "user"
    ? expansion.expanded
    : expansion.expanded || streaming;

  useEffect(() => {
    setExpansion((prev) => {
      if (prev.source === "user") return prev;
      if (prev.expanded === streaming) return prev;
      return { expanded: streaming, source: "auto" };
    });
  }, [streaming]);

  if (!cleaned) return null;

  const contentId = `thinking-${blockId ?? "x"}-content`;
  const toggle = () => {
    setExpansion({ expanded: !isExpanded, source: "user" });
  };

  return (
    <div className="thinking-block">
      <button
        type="button"
        className="thinking-row"
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={toggle}
      >
        <span className="thinking-icon">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="thinking-icon-fade">
          <Brain size={12} />
        </span>
        <span className="thinking-title">
          Thinking
          {streaming ? <span className="thinking-busy"><span /><span /><span /></span> : null}
        </span>
        {!isExpanded && summary ? (
          <span className="thinking-summary" title={summary}>{summary}</span>
        ) : null}
      </button>
      <div
        id={contentId}
        className={`thinking-content${isExpanded ? " open" : ""}`}
        aria-hidden={!isExpanded}
      >
        <div className="thinking-content-inner">
          <Markdown>{cleaned}</Markdown>
        </div>
      </div>
    </div>
  );
}