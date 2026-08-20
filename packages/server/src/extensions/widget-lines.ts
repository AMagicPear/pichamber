const ASYNC_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
const INSPECT_PREFIX = "PI_SUBAGENT_INSPECT_JSON:";

type SnapshotNode = {
  label: string;
  state: string;
  activity?: { currentTool?: string; toolCount?: number };
  children?: SnapshotNode[];
};

const isNode = (value: unknown): value is SnapshotNode => {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<SnapshotNode>;
  return typeof node.label === "string" && typeof node.state === "string";
};

const nodeLines = (node: SnapshotNode, depth = 0): string[] => {
  const activity = node.activity?.currentTool
    ? ` - ${node.activity.currentTool}`
    : node.activity?.toolCount
      ? ` - ${node.activity.toolCount} tools`
      : "";
  const lines = [`${"  ".repeat(depth)}${node.label} - ${node.state}${activity}`];
  for (const child of node.children ?? []) {
    if (isNode(child)) lines.push(...nodeLines(child, depth + 1));
  }
  return lines;
};

const decodeAsyncLine = (line: string): string[] | undefined => {
  if (!line.startsWith(ASYNC_PREFIX)) return undefined;
  try {
    const snapshot = JSON.parse(line.slice(ASYNC_PREFIX.length)) as {
      kind?: unknown;
      version?: unknown;
      runs?: unknown;
      omitted?: { runs?: unknown; children?: unknown };
    };
    if (
      snapshot.kind !== "pi-subagents.async-status-snapshot"
      || snapshot.version !== 1
      || !Array.isArray(snapshot.runs)
      || !snapshot.runs.every(isNode)
    ) return [];
    const lines = snapshot.runs.flatMap((run) => nodeLines(run));
    const omitted = Number(snapshot.omitted?.runs ?? 0) + Number(snapshot.omitted?.children ?? 0);
    if (omitted > 0) lines.push(`${omitted} more`);
    return lines;
  } catch {
    return [];
  }
};

/** Converts machine-readable extension widgets into the compact text surface the web UI supports. */
export const displayWidgetLines = (lines: string[]): string[] => lines.flatMap((line) => {
  if (line.startsWith(INSPECT_PREFIX)) return [];
  return decodeAsyncLine(line) ?? [line];
});
