/* Parse Pi extension widget payloads at the server boundary so browsers receive typed data. */
import type { ExtensionWidget, ActivityNode } from "@pichamber/shared";
import type { RpcExtensionUIRequest } from "@earendil-works/pi-coding-agent";

const ASYNC_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
const INSPECT_PREFIX = "PI_SUBAGENT_INSPECT_JSON:";

const nodeKinds = new Set<ActivityNode["kind"]>(["subagent", "workflow", "step"]);

const optionalNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const optionalString = (value: unknown) => typeof value === "string" ? value : undefined;

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
    const runs = snapshot.runs.map(normalizeNode).filter((run): run is ActivityNode => !!run);
    const omitted = optionalNumber(snapshot.omitted?.runs) ?? 0;
    const omittedChildren = optionalNumber(snapshot.omitted?.children) ?? 0;
    return {
      kind: "task-tree",
      runs,
      ...(omitted + omittedChildren > 0 ? { omitted: omitted + omittedChildren } : {}),
    };
  } catch {
    return undefined;
  }
};

export const normalizeExtensionWidget = (
  request: Extract<RpcExtensionUIRequest, { method: "setWidget" }>,
): ExtensionWidget | undefined => {
  if (!request.widgetLines) return undefined;
  const taskTree = request.widgetLines.map(parseAsyncSnapshot).find((widget): widget is Extract<ExtensionWidget, { kind: "task-tree" }> => widget?.kind === "task-tree");
  if (taskTree) return taskTree;
  const lines = request.widgetLines.filter((line) => !line.startsWith(INSPECT_PREFIX) && !line.startsWith(ASYNC_PREFIX));
  return lines.length ? { kind: "lines", lines } : undefined;
};

export const normalizeWidgetRequest = (
  request: Extract<RpcExtensionUIRequest, { method: "setWidget" }>,
) => ({
  type: "extension_ui_request" as const,
  id: request.id,
  method: "setWidget" as const,
  widgetKey: request.widgetKey,
  widget: normalizeExtensionWidget(request),
  widgetPlacement: request.widgetPlacement,
});
