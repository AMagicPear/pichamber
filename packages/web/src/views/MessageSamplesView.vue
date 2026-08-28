<script setup lang="ts">
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import ConversationMessages from "@/components/conversation/messages/ConversationMessages.vue";
import type { ConversationItem } from "@/stores/session";

const timestamp = 1_735_649_400_000;

const userMessage = (content: string): AgentMessage =>
  ({ role: "user", content, timestamp }) as unknown as AgentMessage;

const assistantMessage = (content: unknown, extra: Record<string, unknown> = {}): AgentMessage =>
  ({
    role: "assistant",
    content,
    timestamp,
    provider: "openai",
    model: "gpt-5.2-codex",
    stopReason: "stop",
    ...extra,
  }) as unknown as AgentMessage;

const toolResult = (toolCallId: string, toolName: string, content: string, isError = false): AgentMessage =>
  ({ role: "toolResult", toolCallId, toolName, content, isError, timestamp }) as unknown as AgentMessage;

const tool = (
  id: string,
  toolName: string,
  args: unknown,
  output: string,
  isError = false,
): ConversationItem => ({
  id,
  kind: "tool",
  tool: { toolCallId: id, toolName, args, isError, running: false },
  message: toolResult(id, toolName, output, isError),
});

const items: ConversationItem[] = [
  { id: "user", kind: "message", message: userMessage("Please update the compact summary card."), streaming: false },
  {
    id: "skill",
    kind: "message",
    message: userMessage('<skill name="frontend-design" location=".pi/skills/frontend-design/SKILL.md">\nUse the existing visual language.\n</skill>'),
    streaming: false,
  },
  {
    id: "assistant",
    kind: "message",
    message: assistantMessage([
      { type: "thinking", thinking: "I will compare the card against existing user messages and inline metadata before making a focused change." },
      { type: "text", text: "I found the compact card uses a visual treatment that is not shared by other message surfaces. I will align it with the existing Skill chip and user-message border language." },
    ]),
    streaming: false,
  },
  tool("bash", "bash", { command: "rg -n \"summary-card\" packages/web/src", timeout: 10 }, "packages/web/src/components/conversation/messages/SummaryCard.vue:13\npackages/web/src/components/conversation/messages/CustomSummaryMessage.vue:19\n\n[Showing lines 1-2000 of 4821 (50.0KB limit). Full output: /var/folders/example/pi-bash-1234.log]"),
  tool("read", "read", { path: "packages/web/src/components/conversation/messages/SummaryCard.vue" }, "<template>\n  <div class=\"summary-card\">\n    <slot />\n  </div>\n</template>"),
  tool("edit", "edit", {
    path: "packages/web/src/components/conversation/messages/SummaryCard.vue",
    edits: [{ oldText: "border-left: 3px solid var(--ui-border);", newText: "border: 1px solid var(--ui-border-subtle);" }],
  }, "Successfully replaced 1 block(s)."),
  tool("apply-patch", "apply_patch", {
    input: "*** Begin Patch\n*** Update File: packages/web/src/components/conversation/messages/SummaryCard.vue\n@@\n-  border-left: 3px solid var(--ui-border);\n+  border: 1px solid var(--ui-border-subtle);\n*** Update File: packages/web/src/components/conversation/messages/AssistantMessage.vue\n@@\n-  color: var(--ui-text);\n+  color: var(--ui-error-strong);\n*** End Patch",
  }, "Done."),
  tool("find", "find", { path: "packages/web/src/components" }, "conversation/messages/SummaryCard.vue\nconversation/messages/UserMessage.vue\nui/ProviderLogo.tsx\n[Truncated: 50 entries limit]"),
  tool("grep", "grep", { query: "border-left", path: "packages/web/src" }, "components/panels/FileTree.vue:210:  border-left: 1px solid var(--ui-border-subtle);\ncomponents/modals/settings/SkillsManager.vue:127:  border-left: 3px solid var(--ui-error-strong);"),
  tool("mcp", "mcp__github__create_issue", { title: "Sample" }, "{\n  \"number\": 42,\n  \"url\": \"https://github.com/example/project/issues/42\"\n}"),
  tool("tool-error", "bash", { command: "git push origin main" }, "remote: Permission to example/project.git denied.\nfatal: unable to access remote repository.", true),
  {
    id: "compaction",
    kind: "message",
    message: {
      role: "compactionSummary",
      tokensBefore: 42_816,
      summary: "The conversation reviewed the message surfaces and removed the non-structural left-side emphasis lines.",
      timestamp,
    } as unknown as AgentMessage,
    streaming: false,
  },
  {
    id: "custom",
    kind: "message",
    message: { role: "custom", content: "A custom message can contain **Markdown** and inline `code`.", timestamp } as unknown as AgentMessage,
    streaming: false,
  },
  {
    id: "branch-summary",
    kind: "message",
    message: { role: "branchSummary", content: "This branch starts from the compact-card styling change.", timestamp } as unknown as AgentMessage,
    streaming: false,
  },
  {
    id: "assistant-error",
    kind: "message",
    message: assistantMessage([], { stopReason: "error", errorMessage: "The provider connection closed before the response completed." }),
    streaming: false,
  },
];
</script>

<template>
  <main class="message-samples">
    <ConversationMessages :items="items" :show-timestamps="true" />
  </main>
</template>

<style scoped>
.message-samples {
  --conversation-content-width: 44rem;
  --conversation-shell-width: 48rem;
  --conversation-inline-gutter: 16px;

  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ui-surface);
}

.message-samples :deep(.conversation__messages) { min-height: 0; }
</style>
