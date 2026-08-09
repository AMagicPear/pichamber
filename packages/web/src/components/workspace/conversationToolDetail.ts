import type { Component } from "vue";
import FileAddIcon from "@/assets/icons/FileAdd.svg";
import FileEditIcon from "@/assets/icons/FileEdit.svg";
import FileTextIcon from "@/assets/icons/FileText.svg";
import { workspace } from "@/stores/workspace";
import { inline } from "./messageContent";
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

/** Strip the workspace prefix so in-workspace files read as relative paths. */
const displayPath = (path: string): string => {
  const cwd = workspace.cwd;
  return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
};

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
      path: relative,
      content: output,
      icon: fileToolIcon(toolName),
      isError: failed,
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
