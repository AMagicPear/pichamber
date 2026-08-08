<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import type { AgentMessage, ConversationTranscriptMessage, LiveConversationState, LiveToolExecution } from "@pichamber/shared";
import BrainIcon from "@/assets/icons/Brain.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";
import ConversationDetail from "./ConversationDetail.vue";
import { getEntryIcon } from "./fileIcon";

const props = defineProps<{
  entries: ConversationTranscriptMessage[];
  live: LiveConversationState;
}>();

const messageFor = (entry: ConversationTranscriptMessage) => entry.message;
const contentFor = (message?: AgentMessage) => message as { content?: unknown } | undefined;
const assistantLabel = (message?: AgentMessage) =>
  message?.role === "assistant" ? message.model : "Assistant";

const textFromContent = (content: unknown) =>
  Array.isArray(content)
    ? content
        .map((part) =>
          part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
            ? String(part.text)
            : "",
        )
        .filter(Boolean)
        .join("\n\n")
    : typeof content === "string"
      ? content
      : "";

const messageText = (message?: AgentMessage) => textFromContent(contentFor(message)?.content);
const inlinePreview = (text: string) => text.replace(/\s+/g, " ").trim();
const thinkingText = (message?: AgentMessage) => {
  const content = contentFor(message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "thinking" && "thinking" in part
        ? String(part.thinking)
        : "",
    )
    .filter(Boolean)
    .join("\n\n");
};

const toolCalls = (message?: AgentMessage) => {
  const content = contentFor(message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "toolCall"
        ? `${"name" in part ? String(part.name) : "tool"}${"arguments" in part ? ` ${JSON.stringify(part.arguments)}` : ""}`
        : "",
    )
    .filter(Boolean)
    .join("\n");
};

const toolCallParts = (message?: AgentMessage) => {
  const content = contentFor(message)?.content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part): part is { type: "toolCall"; name?: unknown; arguments?: unknown } =>
      Boolean(part) && typeof part === "object" && "type" in part && part.type === "toolCall",
  );
};

const toolName = (message?: AgentMessage) => {
  const value = message as { toolName?: unknown } | undefined;
  return typeof value?.toolName === "string" ? value.toolName : undefined;
};
const toolCallFor = (entry: ConversationTranscriptMessage) => {
  const result = messageFor(entry) as { toolCallId?: unknown } | undefined;
  if (typeof result?.toolCallId !== "string") return undefined;
  for (let index = props.entries.indexOf(entry) - 1; index >= 0; index -= 1) {
    const content = contentFor(messageFor(props.entries[index]!))?.content;
    if (!Array.isArray(content)) continue;
    const call = content.find(
      (part) => part && typeof part === "object" && "type" in part && part.type === "toolCall" && "id" in part && part.id === result.toolCallId,
    );
    if (call) return call as { arguments?: unknown };
  }
};
const toolTarget = (entry: ConversationTranscriptMessage, key: "path" | "command") => {
  const args = toolCallFor(entry)?.arguments;
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const value = record[key] ?? (key === "path" ? record.file_path : undefined);
  return typeof value === "string" ? value : undefined;
};
const commandFromArgs = (args: unknown) => {
  if (!args || typeof args !== "object") return undefined;
  const command = (args as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
};
const pathFromArgs = (args: unknown) => {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const path = record.path ?? record.file_path;
  return typeof path === "string" ? path : undefined;
};
const toolCallLabel = (message?: AgentMessage) => {
  const calls = toolCallParts(message);
  return calls.length === 1 && calls[0]?.name === "bash" ? "Shell Command" : "Tool call";
};
const toolCallPreview = (message?: AgentMessage) => {
  const [call] = toolCallParts(message);
  return toolCallLabel(message) === "Shell Command"
    ? commandFromArgs(call?.arguments) ?? ""
    : inlinePreview(toolCalls(message));
};
const toolCommand = (entry: ConversationTranscriptMessage) => toolTarget(entry, "command");
const toolResultLabel = (entry: ConversationTranscriptMessage) => {
  const name = toolName(messageFor(entry));
  const path = toolTarget(entry, "path");
  if (name === "read") return "Read File";
  if (name === "write") return path ? `Wrote ${path}` : "Wrote file";
  if (name === "edit") return path ? `Edited ${path}` : "Edited file";
  if (name === "ls") return path ? `Listed ${path}` : "Listed directory";
  if (name === "bash") return "Shell Command";
  return name ? `${name} result` : "Tool result";
};
const toolResultText = (entry: ConversationTranscriptMessage) => {
  const result = messageText(messageFor(entry)) || JSON.stringify(messageFor(entry), null, 2);
  const command = toolCommand(entry);
  const path = toolTarget(entry, "path");
  return command ? `${command}\n\n${result}` : path ? `${path}\n\n${result}` : result;
};
const toolResultPreview = (entry: ConversationTranscriptMessage) =>
  toolCommand(entry) ?? toolTarget(entry, "path") ?? inlinePreview(messageText(messageFor(entry)));
const splitFilePath = (path?: string) => {
  if (!path) return {};
  const separator = path.lastIndexOf("/");
  return separator < 0 ? { tail: path } : { prefix: path.slice(0, separator + 1), tail: path.slice(separator + 1) };
};
const toolResultPreviewTail = (entry: ConversationTranscriptMessage) =>
  toolName(messageFor(entry)) === "read" ? splitFilePath(toolTarget(entry, "path")).tail : undefined;
const toolResultPreviewPrefix = (entry: ConversationTranscriptMessage) =>
  toolName(messageFor(entry)) === "read"
    ? splitFilePath(toolTarget(entry, "path")).prefix
    : toolResultPreview(entry);
const readFileIcon = (toolName: string, path?: string) =>
  toolName === "read" && path ? getEntryIcon(splitFilePath(path).tail ?? path, false, false) : undefined;
const toolResultIcon = (entry: ConversationTranscriptMessage) =>
  readFileIcon(toolName(messageFor(entry)) ?? "", toolTarget(entry, "path"));
const liveToolLabel = (tool: LiveToolExecution) =>
  tool.toolName === "bash" ? "Shell Command" : tool.toolName === "read" ? "Read File" : tool.running ? `${tool.toolName} running` : `${tool.toolName} result`;
const liveToolPreview = (tool: LiveToolExecution) =>
  tool.toolName === "bash" ? commandFromArgs(tool.args) : tool.toolName === "read" ? splitFilePath(pathFromArgs(tool.args)).prefix : inlinePreview(JSON.stringify(tool.args));
const liveToolPreviewTail = (tool: LiveToolExecution) =>
  tool.toolName === "read" ? splitFilePath(pathFromArgs(tool.args)).tail : undefined;
const liveToolIcon = (tool: LiveToolExecution) => readFileIcon(tool.toolName, pathFromArgs(tool.args));
const liveToolText = (tool: LiveToolExecution) => {
  const output = JSON.stringify(tool.result === undefined ? tool.args : tool.result, null, 2);
  const command = liveToolPreview(tool);
  const path = pathFromArgs(tool.args);
  return command && tool.result !== undefined
    ? `${command}\n\n${output}`
    : path && tool.result !== undefined
      ? `${path}\n\n${output}`
      : output;
};
</script>

<template>
  <div class="conversation__messages">
    <article
      v-for="entry in entries"
      :key="entry.id"
      class="conversation-message"
      :class="{
        'conversation-message--user': messageFor(entry)?.role === 'user',
        'conversation-message--assistant': messageFor(entry)?.role === 'assistant',
        'conversation-message--tool-result': messageFor(entry)?.role === 'toolResult',
      }"
    >
      <pre v-if="messageFor(entry)?.role === 'user'" class="conversation-message__user">{{ messageText(messageFor(entry)) }}</pre>
      <template v-else-if="messageFor(entry)?.role === 'assistant'">
        <header class="conversation-message__author"><BrainIcon /> {{ assistantLabel(messageFor(entry)) }}</header>
        <ConversationDetail v-if="thinkingText(messageFor(entry))" class="conversation-message__details" :icon="BrainIcon" label="Thinking" :preview="inlinePreview(thinkingText(messageFor(entry)))" :content="thinkingText(messageFor(entry))" />
        <MarkdownRender v-if="messageText(messageFor(entry))" class="conversation-message__content" mode="chat" :content="messageText(messageFor(entry))" :final="true" :fade="false" />
        <ConversationDetail v-if="toolCalls(messageFor(entry))" class="conversation-message__details" :icon="TerminalIcon" :label="toolCallLabel(messageFor(entry))" :preview="toolCallPreview(messageFor(entry))" :content="toolCalls(messageFor(entry))" />
      </template>
      <ConversationDetail v-else-if="messageFor(entry)?.role === 'toolResult'" class="conversation-message__details conversation-message__tool-result" :icon="TerminalIcon" :icon-url="toolResultIcon(entry)" :label="toolResultLabel(entry)" :preview="toolResultPreviewPrefix(entry)" :preview-tail="toolResultPreviewTail(entry)" :content="toolResultText(entry)" />
    </article>

    <article v-for="(message, index) in live.pendingUserMessages" :key="`live-user:${index}`" class="conversation-message conversation-message--user">
      <pre class="conversation-message__user">{{ messageText(message) }}</pre>
    </article>
    <article v-if="live.streamingMessage" class="conversation-message conversation-message--assistant">
      <header class="conversation-message__author"><BrainIcon /> {{ assistantLabel(live.streamingMessage) }}</header>
      <ConversationDetail v-if="thinkingText(live.streamingMessage)" class="conversation-message__details" :icon="BrainIcon" label="Thinking" :preview="inlinePreview(thinkingText(live.streamingMessage))" :content="thinkingText(live.streamingMessage)" />
      <MarkdownRender v-if="messageText(live.streamingMessage)" class="conversation-message__content" mode="chat" :content="messageText(live.streamingMessage)" :final="false" :fade="false" />
    </article>
    <ConversationDetail v-for="tool in live.toolExecutions" :key="tool.toolCallId" class="conversation-message conversation-message__details conversation-message__tool-result" :icon="TerminalIcon" :icon-url="liveToolIcon(tool)" :label="liveToolLabel(tool)" :preview="liveToolPreview(tool)" :preview-tail="liveToolPreviewTail(tool)" :content="liveToolText(tool)" />
  </div>
</template>

<style scoped>
.conversation__messages { flex: 1; align-self: stretch; width: 100%; min-width: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 24px max(var(--conversation-inline-gutter), calc((100% - var(--conversation-shell-width)) / 2)) 32px; }
.conversation-message { width: 100%; max-width: var(--conversation-content-width); min-width: 0; margin: 0 auto; padding: 0 clamp(12px, 2.5vw, var(--conversation-inline-gutter)); color: #292827; }
.conversation-message + .conversation-message { margin-top: 28px; }
.conversation-message--assistant + .conversation-message--tool-result { margin-top: 8px; }
.conversation-message--tool-result + .conversation-message--tool-result { margin-top: 6px; }
.conversation-message--tool-result + .conversation-message--assistant, .conversation-message--tool-result + .conversation-message--user { margin-top: 28px; }
.conversation-message__user { width: fit-content; max-width: 85%; margin: 0 0 0 auto; padding: 12px 20px; border: 1px solid #ece9e0; border-radius: 12px 12px 4px; white-space: pre-wrap; overflow-wrap: anywhere; background: #f7f6f2; }
.conversation-message__author { display: flex; align-items: center; gap: 8px; }
.conversation-message__author { margin: 0; color: #292827; font-size: 15px; font-weight: 700; }
.conversation-message__author svg { flex: 0 0 16px; width: 16px; height: 16px; }
.conversation-message__author + .conversation-message__content, .conversation-message__author + .conversation-message__details { margin-top: 8px; }
.conversation-message__details + .conversation-message__content { margin-top: 12px; }
.conversation-message__content + .conversation-message__details { margin-top: 10px; }
.conversation-message__content, .conversation-message__content :deep(.markdown-renderer) { --ms-text-body: 14px; --ms-leading-body: 1.5; --ms-text-h1: 20px; --ms-leading-h1: 1.25; --ms-text-h2: 17px; --ms-leading-h2: 1.3; --ms-text-h3: 15px; --ms-leading-h3: 1.35; --ms-text-h4: 14px; --ms-text-h5: 14px; --ms-text-h6: 14px; --ms-flow-paragraph-y: 8px; --ms-flow-list-y: 8px; --ms-flow-list-item-y: 2px; --ms-flow-codeblock-y: 12px; --ms-flow-blockquote-y: 10px; --ms-flow-table-y: 12px; --ms-flow-hr-y: 16px; --ms-flow-heading-1-mb: 10px; --ms-flow-heading-2-mt: 18px; --ms-flow-heading-2-mb: 8px; --ms-flow-heading-3-mt: 16px; --ms-flow-heading-3-mb: 8px; --ms-flow-heading-4-mt: 14px; --ms-flow-heading-4-mb: 6px; --ms-flow-heading-5-mt: 12px; --ms-flow-heading-5-mb: 6px; --ms-flow-heading-6-mt: 12px; --ms-flow-heading-6-mb: 6px; color: #292827; overflow-wrap: anywhere; }
.conversation-message__content :deep(.conversation-code-block) { margin-block: 12px; }
</style>
