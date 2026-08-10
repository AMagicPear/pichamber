import type { Component } from "vue";
import FileAddIcon from "@/assets/icons/FileAdd.svg";
import FileEditIcon from "@/assets/icons/FileEdit.svg";
import FileTextIcon from "@/assets/icons/FileText.svg";
import { inline } from "./messageContent";
import { displayPath, patchOpsSummary, toolDiff } from "./toolDiff";
export type ConversationToolDetail = {
  label: string;
  /** Collapsed single-line preview (plain text for bash/ls/thinking). */
  preview?: string;
  content: string;
  /** Fixed icon for file tools — read/edit/write each have their own. */
  icon?: Component | string;
  /** Full file path — rendered with filename-first styling. */
  path?: string;
  isError: boolean;
  /** Unified diff of the actual edits (edit/write/apply_patch) — rendered
   *  with DiffView instead of the plain summary text. */
  diff?: string;
  /** read 工具的结果渲染为文件视图（行号+高亮）。 */
  codeFileName?: string;
};

type ToolDetailInput = {
  toolName: string;
  args?: unknown;
  output: string;
  isError?: boolean;
  fallbackPreview: string;
};

const isFileTool = (toolName: string) =>
  toolName === "read" || toolName === "write" || toolName === "edit";

const recordValue = (args: unknown, key: "command" | "path") => {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const value = key === "path" ? record.path ?? record.file_path : record.command;
  return typeof value === "string" ? value : undefined;
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
}: ToolDetailInput): ConversationToolDetail => {
  const failed = isError === true;
  const command = recordValue(args, "command");
  if (toolName === "bash") {
    return {
      label: failed ? errorLabel("Shell Command") : "Shell Command",
      preview: command ?? inline(fallbackPreview),
      content: output,
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
      content: output,
      icon: fileToolIcon(toolName),
      isError: failed,
      // 成功时把真实编辑渲染成 diff（摘要文本被 DiffView 替代）。
      diff: failed ? undefined : toolDiff(toolName, args),
      // read 的结果就是文件内容：渲染成带行号/高亮的文件视图；
      // 失败时直接显示纯文本错误。
      codeFileName: !failed && toolName === "read" ? relative : undefined,
    };
  }

  if (toolName === "apply_patch") {
    const summary = typeof args === "object" && args !== null ? patchOpsSummary((args as { input?: unknown }).input as string) : undefined;
    return {
      label: failed ? errorLabel(toolName) : "Apply Patch",
      preview: summary ?? inline(fallbackPreview),
      content: output,
      isError: failed,
      // apply_patch 的 diff 渲染暂时放弃（多文件解析不理想），先恢复摘要文本。
    };
  }

  if (toolName === "ls") {
    const relative = path ? displayPath(path) : undefined;
    return {
      label: failed ? errorLabel("ls") : path ? "List Directory" : "List Files",
      preview: relative ?? inline(fallbackPreview),
      content: output,
      isError: failed,
    };
  }

  return {
    label: failed ? errorLabel(toolName) : toolName || "Tool",
    preview: inline(fallbackPreview),
    content: output,
    isError: failed,
  };
};
