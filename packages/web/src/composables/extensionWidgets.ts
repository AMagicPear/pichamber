/**
 * 扩展 widget 的浏览器侧解析与渲染分发。
 *
 * 官方 `ui.setWidget(key, content: string[] | undefined)` 只保证载体是
 * 字符串数组，内容语义由各扩展自定。这里提供一个小型适配器体系：
 * 每个扩展注册一个 `WidgetParser`（纯函数），把它的私有行格式解析成
 * 通用 `ExtensionWidget` 渲染形状；没有适配器命中时退回通用 lines
 * 渲染——这是任何类型扩展（不限于 subagent）的默认呈现。
 *
 * 渲染分发按 `kind`：lines → composer 下方状态脚注；其余结构化 kind
 * （tree 等）→ composer 上方活动卡片。
 *
 * 适配新扩展的路径：
 * 1. 形状能映射成 `ActivityNode` 树（多数 subagent 扩展）→ 写一个
 *    parser 返回 `{ kind: "tree" }`，复用 `ActivityTree` 渲染，只在
 *    `widgetParsers` 数组加一行。
 * 2. 需要全新形状 → 加一个 kind + 活动卡片内的渲染分支 + 组件。
 */
import { parsePiSubagentsWidget } from "./widgetAdapters/piSubagents";

export type ActivityNode = {
  id: string;
  kind: "subagent" | "workflow" | "step";
  label: string;
  state: string;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  activity?: {
    state?: string;
    currentTool?: string;
    lastActivityAt?: number;
    currentToolStartedAt?: number;
    turnCount?: number;
    toolCount?: number;
  };
  children?: ActivityNode[];
};

/** 适配后的渲染形状：lines 是通用降级；tree 是树形节点（复用 ActivityTree）。 */
export type ExtensionWidget =
  | { kind: "lines"; lines: string[] }
  | { kind: "tree"; nodes: ActivityNode[]; omitted?: number };

/** 扩展私有 widget 协议 → 通用渲染形状。返回 undefined 表示不识别，交给下一个。 */
export type WidgetParser = (key: string, lines: string[]) => ExtensionWidget | undefined;

/** 内置适配器按注册顺序尝试；新扩展在这里加一个 parser。 */
const widgetParsers: WidgetParser[] = [parsePiSubagentsWidget];

/** 注册一个新扩展的 widget 适配器（追加到尝试列表尾部）。 */
export const registerWidgetParser = (parser: WidgetParser) => {
  widgetParsers.push(parser);
};

/** widget 行 → 渲染形状。未命中的行整组作为文本行（通用降级）。 */
export const normalizeExtensionWidget = (
  key: string,
  widgetLines: string[] | undefined,
): ExtensionWidget | undefined => {
  if (!widgetLines) return undefined;
  for (const parser of widgetParsers) {
    const widget = parser(key, widgetLines);
    if (widget) return widget;
  }
  return widgetLines.length > 0 ? { kind: "lines", lines: widgetLines } : undefined;
};
