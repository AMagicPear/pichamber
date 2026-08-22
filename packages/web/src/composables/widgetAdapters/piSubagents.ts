/**
 * pi-subagents 扩展的 widget 适配器。
 *
 * 它把子代理任务快照编码成 `PI_SUBAGENT_ASYNC_JSON:` 前缀行（协议自带
 * kind/version，见 pi-subagents 的 async-status-snapshot.ts），另有
 * `PI_SUBAGENT_INSPECT_JSON:` 机器行。这里把快照解析成通用 `tree`
 * 渲染形状（复用 ActivityTree），其余行过滤机器前缀后作为 lines。
 * 协议不是稳定规范：快照 version 不识别时整体不显示（行会被过滤）。
 */
import type { ActivityNode, ExtensionWidget, WidgetParser } from "../extensionWidgets";

const ASYNC_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
const INSPECT_PREFIX = "PI_SUBAGENT_INSPECT_JSON:";

const nodeKinds = new Set<ActivityNode["kind"]>(["subagent", "workflow", "step"]);

const optionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const optionalString = (value: unknown) => (typeof value === "string" ? value : undefined);

const isNode = (value: unknown): value is Record<string, unknown> & {
  id: string;
  kind: ActivityNode["kind"];
  label: string;
  state: string;
} => {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<ActivityNode>;
  return (
    typeof node.id === "string"
    && typeof node.kind === "string"
    && nodeKinds.has(node.kind as ActivityNode["kind"])
    && typeof node.label === "string"
    && typeof node.state === "string"
  );
};

const normalizeNode = (value: unknown): ActivityNode | undefined => {
  if (!isNode(value)) return undefined;
  const activity = value.activity && typeof value.activity === "object"
    ? value.activity as Record<string, unknown>
    : undefined;
  return {
    id: value.id,
    kind: value.kind,
    label: value.label,
    state: value.state,
    ...(optionalNumber(value.startedAt) !== undefined ? { startedAt: optionalNumber(value.startedAt) } : {}),
    ...(optionalNumber(value.updatedAt) !== undefined ? { updatedAt: optionalNumber(value.updatedAt) } : {}),
    ...(optionalNumber(value.endedAt) !== undefined ? { endedAt: optionalNumber(value.endedAt) } : {}),
    ...(activity ? {
      activity: {
        ...(optionalString(activity.state) ? { state: optionalString(activity.state) } : {}),
        ...(optionalString(activity.currentTool) ? { currentTool: optionalString(activity.currentTool) } : {}),
        ...(optionalNumber(activity.lastActivityAt) !== undefined ? { lastActivityAt: optionalNumber(activity.lastActivityAt) } : {}),
        ...(optionalNumber(activity.currentToolStartedAt) !== undefined ? { currentToolStartedAt: optionalNumber(activity.currentToolStartedAt) } : {}),
        ...(optionalNumber(activity.turnCount) !== undefined ? { turnCount: optionalNumber(activity.turnCount) } : {}),
        ...(optionalNumber(activity.toolCount) !== undefined ? { toolCount: optionalNumber(activity.toolCount) } : {}),
      },
    } : {}),
    ...(Array.isArray(value.children) ? {
      children: value.children.map(normalizeNode).filter((child): child is ActivityNode => !!child),
    } : {}),
  };
};

const parseAsyncSnapshot = (line: string): ExtensionWidget | undefined => {
  if (!line.startsWith(ASYNC_PREFIX)) return undefined;
  try {
    const snapshot = JSON.parse(line.slice(ASYNC_PREFIX.length)) as {
      kind?: unknown;
      version?: unknown;
      runs?: unknown;
      omitted?: { runs?: unknown; children?: unknown };
    };
    if (snapshot.kind !== "pi-subagents.async-status-snapshot" || snapshot.version !== 1 || !Array.isArray(snapshot.runs)) return undefined;
    const nodes = snapshot.runs.map(normalizeNode).filter((run): run is ActivityNode => !!run);
    const omitted = optionalNumber(snapshot.omitted?.runs) ?? 0;
    const omittedChildren = optionalNumber(snapshot.omitted?.children) ?? 0;
    return {
      kind: "tree",
      nodes,
      ...(omitted + omittedChildren > 0 ? { omitted: omitted + omittedChildren } : {}),
    };
  } catch {
    return undefined;
  }
};

/** pi-subagents 适配器：ASYNC 快照 → tree；其余行过滤机器前缀 → lines。 */
export const parsePiSubagentsWidget: WidgetParser = (_key, lines) => {
  const tree = lines
    .map(parseAsyncSnapshot)
    .find((widget): widget is Extract<ExtensionWidget, { kind: "tree" }> => widget?.kind === "tree");
  if (tree) return tree;
  const visible = lines.filter((line) => !line.startsWith(INSPECT_PREFIX) && !line.startsWith(ASYNC_PREFIX));
  return visible.length > 0 ? { kind: "lines", lines: visible } : undefined;
};
