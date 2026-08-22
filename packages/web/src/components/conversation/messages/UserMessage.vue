<script setup lang="ts">
import { computed, ref } from "vue";
import type { AgentMessage } from "@amagicpear/pichamber-shared";
import MessageActions from "./MessageActions.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import { messageImages, messageText } from "./messageContent";
import SkillBlockChip from "./SkillBlockChip.vue";

const emit = defineEmits<{ fork: []; copy: [text: string] }>();

/** Toggled by hovering the message; drives the `<Transition>` that
 *  shows/hides the action buttons. */
const actionsVisible = ref(false);

type SkillChip = { name: string; location: string };

const props = defineProps<{
  message: AgentMessage;
  /** Pre-formatted by the parent from message.timestamp, so the row
   *  reads the same source as AssistantMessage and the user-side footer
   *  matches the assistant-side inline time. */
  timestampText?: string;
}>();

/** Browser-safe reimplementation of pi's skill block parser.
 *  The browser bundle cannot import the `@earendil-works/pi-coding-agent`
 *  package — its top-level evaluation path references `process.env` and
 *  other Node globals, which Vite refuses to shim. The parser itself is
 *  pure-string (a single regex match), so this keeps the chat-list
 *  rendering path independent of the Node-side SDK.
 *
 * The canonical text shape produced on submit is:
 *
 *   <skill name="<name>" location="<file>">
 *   References are relative to <dir>.
 *
 *   <body>
 *   </skill>
 *
 * Optionally followed by a blank line + the user's trailing text.
 */
const SKILL_BLOCK_RE =
  /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

/** What the row actually renders: optional skill chip + optional text.
 *  Skill messages come out of `/skill:name` as
 *  `<skill name=… location=…>…</skill>` plus optional trailing text the
 *  user typed — splitting them lets the template mount each in its own
 *  container, and keeps the markdown renderer from ever seeing the
 *  HTML-shaped blob (its sanitizer would clip on the inner `<table>`
 *  tags). */
const parts = computed<{ skill: SkillChip | null; text: string }>(() => {
  const text = messageText(props.message);
  // Fast-path: the canonical shape always starts with "<skill ". Plain
  // text skips the regex entirely.
  const parsed = text.startsWith("<skill ") ? SKILL_BLOCK_RE.exec(text) : null;
  if (!parsed) return { skill: null, text };
  const userMessage = parsed[4]?.trim();
  return {
    skill: { name: parsed[1] ?? "", location: parsed[2] ?? "" },
    text: userMessage ? userMessage : "",
  };
});
</script>

<template>
  <article
    class="conversation-message conversation-message--user"
    @mouseenter="actionsVisible = true"
    @mouseleave="actionsVisible = false"
  >
    <!-- Each attachment lives in its own container, outside the text
         bubble. Image and skill chip don't share a layout box; the
         bubble below only ever carries text the user actually wrote. -->
    <div
      v-for="(img, i) in messageImages(message)"
      :key="`image:${i}`"
      class="conversation-message__image"
    >
      <img
        :src="`data:${img.mimeType};base64,${img.data}`"
        alt="Attached image"
        loading="lazy"
        decoding="async"
      />
    </div>
    <div v-if="parts.skill" class="conversation-message__skill">
      <SkillBlockChip :name="parts.skill.name" :location="parts.skill.location" />
    </div>
    <div v-if="parts.text" class="conversation-message__user">
      <ChatMarkdown :content="parts.text" />
    </div>
    <div v-if="timestampText" class="conversation-message__footer">
      <MessageActions
        :show="{ fork: true, copy: !!parts.text }"
        :open="actionsVisible"
        @fork="emit('fork')"
        @copy="emit('copy', parts.text)"
      />
      <p class="conversation-message__timestamp">{{ timestampText }}</p>
    </div>
  </article>
</template>

<style scoped>
.conversation-message--user { display: flex; flex-direction: column; align-items: flex-end; }

/* Footer line: timestamp plus the fork/copy buttons on the same row,
 * right-aligned. The buttons use `IconButton` at `size="mini"` and are
 * shown/hidden via Vue's `<Transition>` on a hovered state. */
.conversation-message__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin: 6px 0 0;
  min-height: 16px;
}


/* Timestamp footer: tucked to the right edge under the right-anchored
 * bubble so it reads as a quiet metadata note, not content. */
.conversation-message__timestamp {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
}
.conversation-message--user .conversation-message__timestamp { text-align: right; }

/* Text bubble — pure text, nothing else. min-width: 0 lets the 85% cap
 * take effect against long unbroken strings (paths / URLs). */
.conversation-message__user {
  display: block;
  box-sizing: border-box;
  width: fit-content;
  max-width: 85%;
  min-width: 0;
  margin: 0 0 0 auto;
  padding: 8px 14px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 12px 12px 4px;
  background: var(--ui-surface-muted);
}
.conversation-message__user > * { min-width: 0; max-width: 100%; }

/* Each attachment is its own image message, outside the text bubble. */
.conversation-message__image {
  display: flex;
  justify-content: flex-end;
  width: 85%;
  max-width: 420px;
  margin: 0 0 8px auto;
}
.conversation-message__image img {
  display: block;
  width: auto;
  max-width: 100%;
  max-height: 320px;
  border-radius: 8px;
  object-fit: contain;
  animation: user-image-enter 180ms var(--ui-ease-emphasized) both;
}

/* Skill chip: its own container, independent of images (no shared width
   cap) and outside the text bubble. Right-aligned so it matches the
   bubble's edge; fit-content so the chip itself owns its sizing. */
.conversation-message__skill {
  display: flex;
  justify-content: flex-end;
  margin: 0 0 8px auto;
}
@keyframes user-image-enter {
  from { opacity: 0; transform: translateY(3px); }
}

@media (prefers-reduced-motion: reduce) {
  .conversation-message__image img { animation: none; }
}
</style>
