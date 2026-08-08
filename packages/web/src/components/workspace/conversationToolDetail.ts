import { getEntryIcon } from "./fileIcon";

export type ConversationToolDetail = {
  label: string;
  preview: string;
  previewTail?: string;
  content: string;
  iconUrl?: string;
};

type ToolDetailInput = {
  toolName: string;
  args?: unknown;
  output: string;
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

export const conversationToolDetail = ({
  toolName,
  args,
  output,
  fallbackPreview,
}: ToolDetailInput): ConversationToolDetail => {
  const command = recordValue(args, "command");
  if (toolName === "bash") {
    return {
      label: "Shell Command",
      preview: command ?? inline(fallbackPreview),
      content: command ? `${command}\n\n${output}` : output,
    };
  }

  const path = recordValue(args, "path");
  if (isFileTool(toolName) && path) {
    const { prefix, tail } = splitFilePath(path);
    return {
      label: fileLabel(toolName),
      preview: prefix,
      previewTail: tail,
      content: `${path}\n\n${output}`,
      iconUrl: getEntryIcon(tail, false, false),
    };
  }

  if (toolName === "ls") {
    return {
      label: path ? "List Directory" : "List Files",
      preview: path ?? inline(fallbackPreview),
      content: path ? `${path}\n\n${output}` : output,
    };
  }

  return {
    label: toolName || "Tool",
    preview: inline(fallbackPreview),
    content: output,
  };
};
