import { inline } from "./messageContent";
import { displayPath, isFileTool, numberArg, patchOpsSummary, stringArg } from "./toolDiff";
import { type ToolBody, type ToolImage, toolBody } from "./toolBody";
import { i18n } from "@/i18n";
import type { LucideIconName } from "@/components/ui/morphIcons";

export type ConversationToolDetail = {
  /** i18n key for the tool label; `<ConversationDetail>` resolves it via
   *  `t(labelKey, labelParams)` at render time, so the memoized detail
   *  stays language-reactive. */
  labelKey: string;
  /** Interpolation params for `labelKey` (`tools.custom` uses `{name}`). */
  labelParams?: Record<string, unknown>;
  /** Collapsed single-line preview (plain text for bash/ls/thinking). */
  preview?: string;
  /** Body shape; consumed by `<ConversationDetail>` for the expanded area. */
  body: ToolBody;
  /** Lucide icon name (e.g. `"square-terminal"`) resolved by
   *  `<ConversationDetail>` via `lucideIcon` at render time. */
  icon?: LucideIconName;
  /** Full file path — rendered with filename-first styling. */
  path?: string;
  /** 显式执行时长限制（bash 传了 timeout 参数时才有），渲染成行尾小胶囊。 */
  timeout?: number;
  /** 命令是否正在运行：运行中胶囊显示剩余秒数倒计时，结束后显示 timeout 原值。 */
  running?: boolean;
  /** 工具开始执行的时刻（ms），live 条目才有；倒计时按它校准。 */
  startedAt?: number;
  durationMs?: number;
  nestedCalls?: import("@earendil-works/pi-ai").NestedToolCalls;
  code?: string;
  isError: boolean;
};

type ToolDetailInput = {
  toolName: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  /** 来自 message 的图片附件（read 图片文件时填充）。 */
  images?: ToolImage[];
};

const fileToolIcon = (toolName: string) =>
  toolName === "edit" ? "file-pen" : toolName === "write" ? "file-plus" : "file-text";

/** 已知工具名 → 翻译键；未知工具/MCP 插件工具走 `tools.custom` 原样透传名称，
 *  让 label 始终统一走 `t(labelKey, labelParams)`。 */
const labelKeyFor = (toolName: string): { labelKey: string; labelParams?: Record<string, unknown> } => {
  switch (toolName) {
    case "bash":
      return { labelKey: "tools.shellCommand" };
    case "read":
      return { labelKey: "tools.readFile" };
    case "write":
      return { labelKey: "tools.writeFile" };
    case "edit":
      return { labelKey: "tools.editFile" };
    case "apply_patch":
      return { labelKey: "tools.applyPatch" };
    case "find":
      return { labelKey: "tools.findFiles" };
    case "grep":
      return { labelKey: "tools.grep" };
    case "mcp":
      return { labelKey: "tools.mcp" };
    case "mcpScript":
      return { labelKey: "tools.mcpScript" };
    case "codemode":
      return { labelKey: "tools.custom", labelParams: { name: "Codemode" } };
    default:
      // 官方 MCP 工具保留完整命名空间，便于识别服务器。
      return { labelKey: "tools.custom", labelParams: { name: toolName || i18n.global.t("tools.tool") } };
  }
};

export const conversationToolDetail = ({
  toolName,
  args,
  output,
  isError,
  images,
}: ToolDetailInput): ConversationToolDetail => {
  const failed = isError === true;
  const command = stringArg(args, "command");
  const path = stringArg(args, "path");
  const { labelKey, labelParams } = labelKeyFor(toolName);

  if (toolName === "bash") {
    return {
      labelKey,
      labelParams,
      preview: command ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "square-terminal",
      timeout: numberArg(args, "timeout"),
      isError: failed,
    };
  }

  if (isFileTool(toolName) && path) {
    return {
      labelKey,
      labelParams,
      // 失败也保留路径：让用户知道是哪个文件操作失败。
      path: displayPath(path),
      body: toolBody({ toolName, args, output, isError, images }),
      icon: fileToolIcon(toolName),
      isError: failed,
    };
  }

  if (toolName === "apply_patch") {
    const summary =
      typeof args === "object" && args !== null
        ? patchOpsSummary((args as { input?: unknown }).input as string)
        : undefined;
    return {
      labelKey: "tools.applyPatch",
      labelParams,
      preview: summary ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "file-pen",
      isError: failed,
    };
  }

  if (toolName === "ls") {
    const relative = path ? displayPath(path) : undefined;
    return {
      labelKey: path ? "tools.listDirectory" : "tools.listFiles",
      preview: relative ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "folders",
      isError: failed,
    };
  }

  if (toolName === "find") {
    const relative = path ? displayPath(path) : undefined;
    return {
      labelKey,
      labelParams,
      preview: relative ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "search",
      isError: failed,
    };
  }

  if (toolName === "grep") {
    return {
      labelKey,
      labelParams,
      preview: inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "search-check",
      isError: failed,
    };
  }

  if (toolName === "codemode") {
    const code = typeof args === "string" ? args : stringArg(args, "code");
    return { labelKey, labelParams, code, preview: code ? inline(code) : inline(output), body: toolBody({ toolName, args, output, isError, images }), icon: "code", isError: failed };
  }

  if (toolName === "tool_search") {
    return { labelKey, labelParams, preview: stringArg(args, "query") ?? inline(output), body: toolBody({ toolName, args, output, isError, images }), icon: "search", isError: failed };
  }

  // 保留历史 MCP 调用的展示，同时识别官方资源工具。
  if (toolName === "mcp" || toolName === "mcpScript" || toolName.startsWith("mcp_") || toolName === "list_mcp_resources" || toolName === "list_mcp_resource_templates" || toolName === "read_mcp_resource") {
    return {
      labelKey,
      labelParams,
      preview: inline(output),
      body: toolBody({ toolName, args, output, isError, images }),
      icon: "mcp",
      isError: failed,
    };
  }

  // Agent-family tools (Agent / get_subagent_result / steer_subagent /
  // SubagentWorkflow / ...): single shared `bot` icon, no extra label handling.
  if (/agent/i.test(toolName)) {
    return {
      labelKey,
      labelParams,
      preview: inline(output),
      body: toolBody({ toolName, args, output, isError, images }),
      icon: "bot",
      isError: failed,
    };
  }

  return {
    labelKey,
    labelParams,
    preview: inline(output),
    body: toolBody({ toolName, args, output, isError, images }),
    isError: failed,
  };
};
