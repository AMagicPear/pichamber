import type { Component } from "vue";
import FileAddIcon from "@/assets/icons/FileAdd.svg";
import FileEditIcon from "@/assets/icons/FileEdit.svg";
import FileTextIcon from "@/assets/icons/FileText.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
import { inline } from "./messageContent";
import { displayPath, patchOpsSummary } from "./toolDiff";
import { type ToolBody, type ToolImage, toolBody } from "./toolBody";

export type ConversationToolDetail = {
  label: string;
  /** Collapsed single-line preview (plain text for bash/ls/thinking). */
  preview?: string;
  /** Body shape; consumed by `<ConversationDetail>` for the expanded area. */
  body: ToolBody;
  /** Fixed icon for file tools — read/edit/write each have their own. */
  icon?: Component | string;
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
  fallbackPreview: string;
  /** 来自 message 的图片附件（read 图片文件时填充）。 */
  images?: ToolImage[];
};

const isFileTool = (toolName: string) =>
  toolName === "read" || toolName === "write" || toolName === "edit";

const recordValue = (args: unknown, key: "command" | "path") => {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const value = key === "path" ? record.path ?? record.file_path : record.command;
  return typeof value === "string" ? value : undefined;
};

const recordNumber = (args: unknown, key: string) => {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const fileToolIcon = (toolName: string): Component | string =>
  toolName === "edit" ? FileEditIcon : toolName === "write" ? FileAddIcon : FileTextIcon;

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
  fallbackPreview,
  images,
}: ToolDetailInput): ConversationToolDetail => {
  const failed = isError === true;
  const command = recordValue(args, "command");
  if (toolName === "bash") {
    return {
      label: failed ? errorLabel("Shell Command") : "Shell Command",
      preview: command ?? inline(fallbackPreview),
      body: toolBody({ toolName, args, output, isError }),
      icon: TerminalIcon,
      timeout: recordNumber(args, "timeout"),
      isError: failed,
    };
  }

  const path = recordValue(args, "path");
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
    const summary = typeof args === "object" && args !== null ? patchOpsSummary((args as { input?: unknown }).input as string) : undefined;
    return {
      label: failed ? errorLabel(toolName) : "Apply Patch",
      preview: summary ?? inline(fallbackPreview),
      body: toolBody({ toolName, args, output, isError }),
      icon: FileEditIcon,
      isError: failed,
    };
  }

  if (toolName === "ls") {
    const relative = path ? displayPath(path) : undefined;
    return {
      label: failed ? errorLabel("ls") : path ? "List Directory" : "List Files",
      preview: relative ?? inline(fallbackPreview),
      body: toolBody({ toolName, args, output, isError }),
      isError: failed,
    };
  }

  return {
    label: failed ? errorLabel(toolName) : toolName || "Tool",
    preview: inline(fallbackPreview),
    body: toolBody({ toolName, args, output, isError }),
    isError: failed,
  };
};