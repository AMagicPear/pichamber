import { inline } from "./messageContent";
import { displayPath, isFileTool, numberArg, patchOpsSummary, stringArg } from "./toolDiff";
import { type ToolBody, type ToolImage, toolBody } from "./toolBody";
import type { LucideIconName } from "@/components/ui/lucideIcons";

export type ConversationToolDetail = {
  label: string;
  /** Collapsed single-line preview (plain text for bash/ls/thinking). */
  preview?: string;
  /** Body shape; consumed by `<ConversationDetail>` for the expanded area. */
  body: ToolBody;
  /** Lucide icon name (e.g. `"square-terminal"`) resolved by
   *  `<ConversationDetail>` via `useLucideIcon` at render time. */
  icon?: LucideIconName;
  /** Full file path — rendered with filename-first styling. */
  path?: string;
  /** 显式执行时长限制（bash 传了 timeout 参数时才有），渲染成行尾小胶囊。 */
  timeout?: number;
  /** 命令是否正在运行：运行中胶囊显示剩余秒数倒计时，结束后显示 timeout 原值。 */
  running?: boolean;
  /** 工具开始执行的时刻（ms），live 条目才有；倒计时按它校准。 */
  startedAt?: number;
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

const fileLabel = (toolName: string) =>
  `${toolName.charAt(0).toUpperCase()}${toolName.slice(1)} File`;

const errorLabel = (toolName: string) => {
  const base = toolName || "Tool";
  return `${base.charAt(0).toUpperCase()}${base.slice(1)} failed`;
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
  if (toolName === "bash") {
    return {
      label: failed ? errorLabel("Shell Command") : "Shell Command",
      preview: command ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "square-terminal",
      timeout: numberArg(args, "timeout"),
      isError: failed,
    };
  }

  const path = stringArg(args, "path");
  if (isFileTool(toolName) && path) {
    const relative = displayPath(path);
    return {
      label: failed ? errorLabel(toolName) : fileLabel(toolName),
      // 失败也保留路径：让用户知道是哪个文件操作失败。
      path: relative,
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
      label: failed ? errorLabel(toolName) : "Apply Patch",
      preview: summary ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "file-pen",
      isError: failed,
    };
  }

  if (toolName === "ls") {
    const relative = path ? displayPath(path) : undefined;
    return {
      label: failed ? errorLabel("ls") : path ? "List Directory" : "List Files",
      preview: relative ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "folders",
      isError: failed,
    };
  }

  if (toolName === "find") {
    const relative = path ? displayPath(path) : undefined;
    return {
      label: failed ? errorLabel("find") : "Find Files",
      preview: relative ?? inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "search",
      isError: failed,
    };
  }

  if (toolName === "grep") {
    return {
      label: failed ? errorLabel("grep") : "Grep",
      preview: inline(output),
      body: toolBody({ toolName, args, output, isError }),
      icon: "search-check",
      isError: failed,
    };
  }

  return {
    label: failed ? errorLabel(toolName) : toolName || "Tool",
    preview: inline(output),
    body: toolBody({ toolName, args, output, isError }),
    isError: failed,
  };
};
