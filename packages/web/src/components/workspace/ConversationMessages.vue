<script setup lang="ts">
import MarkdownRender from "markstream-vue";
import type { ConversationMessage, SessionEntry } from "@pichamber/shared";
import BrainIcon from "@/assets/icons/Brain.svg";
import TerminalIcon from "@/assets/icons/TerminalBox.svg";

const props = defineProps<{
  messages: ConversationMessage[];
}>();

const entryFor = (message: ConversationMessage) => {
  const payload = message.payload;
  return "parentId" in payload ? (payload as SessionEntry) : undefined;
};

const agentMessageFor = (message: ConversationMessage) => {
  const entry = entryFor(message);
  return entry?.type === "message" ? entry.message : undefined;
};

const messageRole = (message: ConversationMessage) => agentMessageFor(message)?.role;
const messageContentFor = (message: ConversationMessage) =>
  agentMessageFor(message) as { content?: unknown } | undefined;

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

const messageText = (message: ConversationMessage) => textFromContent(messageContentFor(message)?.content);

const thinkingText = (message: ConversationMessage) => {
  const content = messageContentFor(message)?.content;
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

const toolCalls = (message: ConversationMessage) => {
  const content = messageContentFor(message)?.content;
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

const messageType = (message: ConversationMessage) => message.payload.type;
const messageContent = (message: ConversationMessage) => JSON.stringify(message.payload, null, 2);
const toolResultContent = (message: ConversationMessage) => messageText(message) || messageContent(message);
const toolName = (message: ConversationMessage) => {
  const agentMessage = agentMessageFor(message) as { toolName?: unknown } | undefined;
  return typeof agentMessage?.toolName === "string" ? agentMessage.toolName : undefined;
};
const specialToolNames = new Set(["read", "write", "edit", "ls", "bash"]);
const hasSpecialToolResult = (message: ConversationMessage) => {
  const name = toolName(message);
  return messageRole(message) === "toolResult" && name !== undefined && specialToolNames.has(name);
};
const toolCallFor = (message: ConversationMessage) => {
  const result = agentMessageFor(message) as { toolCallId?: unknown } | undefined;
  if (typeof result?.toolCallId !== "string") return undefined;

  for (let index = props.messages.indexOf(message) - 1; index >= 0; index -= 1) {
    const content = messageContentFor(props.messages[index]!)?.content;
    if (!Array.isArray(content)) continue;
    const toolCall = content.find(
      (part) =>
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "toolCall" &&
        "id" in part &&
        part.id === result.toolCallId,
    );
    if (toolCall) return toolCall as { arguments?: unknown };
  }
  return undefined;
};
const toolTarget = (message: ConversationMessage, key: "path" | "command") => {
  const args = toolCallFor(message)?.arguments;
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key] ?? (key === "path" ? (args as Record<string, unknown>).file_path : undefined);
  return typeof value === "string" ? value : undefined;
};
const toolResultLabel = (message: ConversationMessage) => {
  const name = toolName(message);
  const path = toolTarget(message, "path");
  if (name === "read") return path ? `Read ${path}` : "Read file";
  if (name === "write") return path ? `Wrote ${path}` : "Wrote file";
  if (name === "edit") return path ? `Edited ${path}` : "Edited file";
  if (name === "ls") return path ? `Listed ${path}` : "Listed directory";
  if (name === "bash") return toolTarget(message, "command") ?? "Command output";
  return "Tool result";
};
</script>

<template>
  <div class="conversation__messages">
    <article
      v-for="message in messages"
      :key="message.id"
      class="conversation-message"
      :class="{
        'conversation-message--user': messageRole(message) === 'user',
        'conversation-message--assistant': messageRole(message) === 'assistant',
      }"
    >
      <pre v-if="messageRole(message) === 'user'" class="conversation-message__user">{{ messageText(message) }}</pre>

      <template v-else-if="messageRole(message) === 'assistant'">
        <header class="conversation-message__author"><BrainIcon /> Assistant</header>
        <details v-if="thinkingText(message)" class="conversation-message__details">
          <summary><BrainIcon /> Thinking</summary>
          <pre>{{ thinkingText(message) }}</pre>
        </details>
        <MarkdownRender
          v-if="messageText(message)"
          class="conversation-message__content"
          mode="chat"
          :content="messageText(message)"
          :final="true"
          :fade="false"
        />
        <details v-if="toolCalls(message)" class="conversation-message__details">
          <summary><TerminalIcon /> Tool call</summary>
          <pre>{{ toolCalls(message) }}</pre>
        </details>
      </template>

      <details
        v-else-if="hasSpecialToolResult(message)"
        class="conversation-message__details conversation-message__tool-result"
        :class="`conversation-message__tool-result--${toolName(message)}`"
      >
        <summary><TerminalIcon /> {{ toolResultLabel(message) }}</summary>
        <pre>{{ toolResultContent(message) }}</pre>
      </details>

      <details v-else class="conversation-message__raw">
        <summary>{{ messageType(message) }}</summary>
        <pre>{{ messageContent(message) }}</pre>
      </details>
    </article>
  </div>
</template>

<style scoped>
.conversation__messages {
  flex: 1;
  align-self: stretch;
  width: 100%;
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 max(
    var(--conversation-inline-gutter),
    calc((100% - var(--conversation-shell-width)) / 2)
  ) 16px;
}
.conversation-message {
  width: 100%;
  max-width: var(--conversation-content-width);
  min-width: 0;
  margin: 0 auto;
  padding: 8px clamp(12px, 2.5vw, var(--conversation-inline-gutter));
  color: #292827;
}
.conversation-message--user,
.conversation-message--assistant {
  padding-block: 16px;
}
.conversation-message__user {
  width: fit-content;
  max-width: 85%;
  margin: 0 0 0 auto;
  padding: 12px 20px;
  border: 1px solid #ece9e0;
  border-radius: 12px 12px 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f7f6f2;
}
.conversation-message__author,
.conversation-message__details summary {
  display: flex;
  align-items: center;
  gap: 8px;
}
.conversation-message__author {
  margin-bottom: 8px;
  color: #45433e;
  font-size: 14px;
  font-weight: 700;
}
.conversation-message__author svg,
.conversation-message__details summary svg {
  width: 16px;
  height: 16px;
}
.conversation-message__content {
  color: #292827;
  font-size: 15px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.conversation-message__content:deep(.node-slot:first-child .paragraph-node) {
  margin-top: 0;
}
.conversation-message__content:deep(.node-slot:last-child .paragraph-node) {
  margin-bottom: 0;
}
.conversation-message__details,
.conversation-message__raw {
  margin: 0 0 12px;
  color: #76746d;
  font-size: 13px;
}
.conversation-message__details summary,
.conversation-message__raw summary {
  cursor: pointer;
}
.conversation-message__details pre,
.conversation-message__raw pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.conversation-message__tool-result--write summary,
.conversation-message__tool-result--edit summary {
  color: #58721c;
}
.conversation-message__tool-result--bash pre {
  color: #4d4b45;
}
.conversation-message__raw {
  padding-left: 12px;
  border-left: 2px solid #dfddd5;
}
.conversation-message__raw summary {
  color: #45433e;
  font-weight: 700;
}
</style>
