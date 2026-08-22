// Lucide icons sourced from `lucide-static` (https://lucide.dev) — the
// official SVG distribution that backs every framework adapter
// (`lucide-vue-next`, `lucide-react`, ...). We `?raw`-import each SVG
// individually and parse it into morphicons' native `IconNode` format
// ([tag, attrs][]). Adding an icon = one more `import` line, exactly
// the same shape as `import { Menu, X } from "lucide"`. Vite tree-shakes
// every unreferenced SVG out of the bundle.

import { fitIcon } from "morphicons";
import type { IconNode } from "morphicons";
import brainRaw from "lucide-static/icons/brain.svg?raw";
import chevronDownRaw from "lucide-static/icons/chevron-down.svg?raw";
import chevronRightRaw from "lucide-static/icons/chevron-right.svg?raw";
import chevronUpRaw from "lucide-static/icons/chevron-up.svg?raw";
import filePenRaw from "lucide-static/icons/file-pen.svg?raw";
import filePlusRaw from "lucide-static/icons/file-plus.svg?raw";
import fileTextRaw from "lucide-static/icons/file-text.svg?raw";
import foldersRaw from "lucide-static/icons/folders.svg?raw";
import mcpRaw from "@/assets/icons/MCP.svg?raw";
import searchRaw from "lucide-static/icons/search.svg?raw";
import searchCheckRaw from "lucide-static/icons/search-check.svg?raw";
import squareTerminalRaw from "lucide-static/icons/square-terminal.svg?raw";
import wrenchRaw from "lucide-static/icons/wrench.svg?raw";
import folderRaw from "lucide-static/icons/folder.svg?raw";
import folderOpenRaw from "lucide-static/icons/folder-open.svg?raw";
import copyRaw from "lucide-static/icons/copy.svg?raw";
import loaderCircleRaw from "lucide-static/icons/loader-circle.svg?raw";
import CheckRaw from "lucide-static/icons/check.svg?raw";
import panelLeftCloseRaw from "lucide-static/icons/panel-left-close.svg?raw";
import panelLeft from "lucide-static/icons/panel-left.svg?raw";
import refreshCwRaw from "lucide-static/icons/refresh-cw.svg?raw";
import refreshCcWRaw from "lucide-static/icons/refresh-ccw.svg?raw";

/** Raw SVG strings keyed by Lucide name. Each entry comes from an
 *  explicit `?raw` import above — Vite drops unused icons from the bundle.
 *  Parsed once into `ICONS` at module load; `lucideIcon` then is O(1). */
const RAWS = {
  brain: brainRaw,
  "chevron-down": chevronDownRaw,
  "chevron-right": chevronRightRaw,
  "file-pen": filePenRaw,
  "file-plus": filePlusRaw,
  "file-text": fileTextRaw,
  folders: foldersRaw,
  mcp: mcpRaw,
  search: searchRaw,
  "search-check": searchCheckRaw,
  "square-terminal": squareTerminalRaw,
  wrench: wrenchRaw,
  folder: folderRaw,
  "folder-open": folderOpenRaw,
  copy: copyRaw,
  "chevron-up": chevronUpRaw,
  "loader-circle": loaderCircleRaw,
  check: CheckRaw,
  "panel-left-close": panelLeftCloseRaw,
  "panel-left": panelLeft,
  "refresh-cw": refreshCwRaw,
  "refresh-ccw": refreshCcWRaw,
} as const;

/** Lucide icon name union. Restricts `icon?: string` props so typos
 *  fail at the type level instead of at runtime. */
export type LucideIconName = keyof typeof RAWS;

/** Parsed SVG: the IconNode shape morphicons wants, plus the root
 *  viewBox string so non-24x24 icons can be re-gridded onto the shared
 *  24x24 grid that MorphIcon hard-codes. Lucide SVGs use a tiny,
 *  predictable subset (`<path>`, `<rect>`, `<circle>`, `<line>`,
 *  `<polyline>`, `<polygon>`, all self-closing with `attr="..."` pairs);
 *  parsed via the browser-native DOMParser — lucideIcons runs in the web
 *  bundle, never in Node. */
const parseSvg = (svg: string): { icon: IconNode; viewBox: string | null } => {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const viewBox = doc.documentElement.getAttribute("viewBox");
  const icon: IconNode = Array.from(
    doc.querySelectorAll("path, rect, circle, line, polyline, polygon"),
    (el) => [
      el.tagName,
      Object.fromEntries(Array.from(el.attributes, (a) => [a.name, a.value])) as Record<
        string,
        string
      >,
    ],
  );
  return { icon, viewBox };
};

const ICONS = Object.fromEntries(
  Object.entries(RAWS).map(([name, svg]) => {
    const { icon, viewBox } = parseSvg(svg);
    // Lucide icons declare `viewBox="0 0 24 24"` already; an SVG with no
    // viewBox attribute is also assumed 24×24 (the default user-space
    // canvas Lucide draws on). Anything else (e.g. the MCP logo on 180×180)
    // gets re-gridded onto 24×24 so MorphIcon's hard-coded viewport draws
    // it in the right place.
    return [name, !viewBox || viewBox === "0 0 24 24" ? icon : fitIcon(icon, viewBox)];
  }),
) as Record<LucideIconName, IconNode>;

/** Plain name → IconNode lookup. Throws via TS on miss — typos at compile
 *  time become loud type errors instead of silent empty icons. */
export const lucideIcon = (name: LucideIconName): IconNode => ICONS[name];
