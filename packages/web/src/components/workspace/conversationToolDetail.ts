import { getEntryIcon } from "./fileIcon";

export type ConversationToolDetail = {
  label: string;
  preview: string;
  previewTail?: string;
  content: string;
  iconUrl?: string;
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

const inline = (value: string) => value.replace(/\s+/g, " ").trim();

const splitFilePath = (path: string) => {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { prefix: "", tail: path }
    : { prefix: path.slice(0, separator + 1), tail: path.slice(separator + 1) };
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
  const command = recordValue(args, "command");
  if (toolName === "bash") {
    return {
      label: isError ? errorLabel("Shell Command") : "Shell Command",
      preview: command ?? inline(fallbackPreview),
      content: command ? `${command}\n\n${output}` : output,
      isError: isError === true,
    };
  }

  const path = recordValue(args, "path");
  if (isFileTool(toolName) && path) {
    const { prefix, tail } = splitFilePath(path);
    return {
      label: isError ? errorLabel(toolName) : fileLabel(toolName),
      preview: prefix,
      previewTail: tail,
      content: `${path}\n\n${output}`,
      iconUrl: getEntryIcon(tail, false, false),
      isError: isError === true,
    };
  }

  if (toolName === "ls") {
    return {
      label: isError ? errorLabel("ls") : path ? "List Directory" : "List Files",
      preview: path ?? inline(fallbackPreview),
      content: path ? `${path}\n\n${output}` : output,
      isError: isError === true,
    };
  }

  return {
    label: isError ? errorLabel(toolName) : toolName || "Tool",
    preview: inline(fallbackPreview),
    content: output,
    isError: isError === true,
  };
};
