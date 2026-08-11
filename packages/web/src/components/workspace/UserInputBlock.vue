<script setup lang="ts">
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelDescriptor } from "@pichamber/shared";
import { nextTick, ref } from "vue";
import AddCircleIcon from "@/assets/icons/AddCircle.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import GithubIcon from "@/assets/icons/Github.svg";
import GitPullRequestIcon from "@/assets/icons/GitPullRequest.svg";
import MicIcon from "@/assets/icons/Mic.svg";
import SendIcon from "@/assets/icons/SendPlane2.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";
import MenuPanel from "@/components/MenuPanel.vue";
import Modal from "@/components/layout/Modal.vue";
import FileRefPicker from "@/components/workspace/FileRefPicker.vue";
import ModelSelector from "@/components/workspace/ModelSelector.vue";
import ThinkingLevelSelector from "@/components/workspace/ThinkingLevelSelector.vue";
import { usePopover } from "@/composables/usePopover";

const draft = defineModel<string | undefined>({ required: true });

defineProps<{
  canSend: boolean;
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  thinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
}>();

const emit = defineEmits<{
  send: [];
  selectModel: [model: ModelDescriptor];
  selectThinkingLevel: [level: ThinkingLevel];
}>();

const onKeydown = (event: KeyboardEvent) => {
  // Enter sends; Shift+Enter inserts a newline.
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    emit("send");
  }
};

const inputEl = ref<HTMLTextAreaElement | null>(null);

/** Insert text at the caret, restoring focus and caret position. */
const insertAtCursor = (text: string) => {
  const el = inputEl.value;
  const current = draft.value ?? "";
  if (el) {
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? start;
    draft.value = current.slice(0, start) + text + current.slice(end);
    nextTick(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  } else {
    draft.value = current + text;
  }
};

// ── @ file reference picker ─────────────────────────────────────────────
// 对齐原生 TUI：输入 @（光标前 token 以 @ 开头、无空格）时弹出项目内文件
// 选择面板；在 textarea 继续打字会通过 @ 前缀联动过滤；选中后把 @token
// 替换为 @相对路径，发送时由服务端展开成 <file> 块 / 图片附件。
const pickerOpen = ref(false);
const pickerQuery = ref("");
/** @ 后的已输入前缀（仅在其变化时同步到面板，避免覆盖面板内编辑）。 */
let lastRefPrefix = "";

const detectAtRef = () => {
  const el = inputEl.value;
  if (!el) {
    pickerOpen.value = false;
    return;
  }
  const before = el.value.slice(0, el.selectionStart);
  const m = /(^|[^\w@])@([^\s]*)$/.exec(before);
  if (m) {
    pickerOpen.value = true;
    if (m[2] !== lastRefPrefix) {
      lastRefPrefix = m[2] ?? "";
      pickerQuery.value = m[2] ?? "";
    }
  } else {
    pickerOpen.value = false;
  }
};

const onKeyup = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    pickerOpen.value = false;
    return;
  }
  // 光标移动后重新判定 @ token（方向键 / Home / End / 点击）。
  if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
    detectAtRef();
  }
};

const onPickFile = (relativePath: string) => {
  pickerOpen.value = false;
  lastRefPrefix = "";
  const el = inputEl.value;
  const current = draft.value ?? "";
  if (!el) {
    draft.value = `${current}@${relativePath}`;
    return;
  }
  // 替换光标前的 @token 为 @相对路径；无 token 时直接插在光标处。
  const before = el.value.slice(0, el.selectionStart);
  const m = /(^|[^\w@])@([^\s]*)$/.exec(before);
  const atIndex = m ? m.index! + m[1]!.length : el.selectionStart;
  draft.value = el.value.slice(0, atIndex) + `@${relativePath}` + el.value.slice(el.selectionStart);
  nextTick(() => {
    el.focus();
    const pos = atIndex + 1 + relativePath.length;
    el.setSelectionRange(pos, pos);
  });
};

// Attachment action menu (links only — files live behind `@` now).
const attachRoot = ref<HTMLElement | null>(null);
const { open: menuOpen, style: menuStyle, close: closeMenu, toggle: toggleMenu } = usePopover({
  root: attachRoot,
  trigger: ".composer__attach-trigger",
  panel: ".menu-panel",
  width: 190,
  // 4px panel padding + two 28px menu rows.
  height: () => 4 + 2 * 28,
});

// GitHub issue / PR link dialog — simplified to pasting a URL.
const linkDialogOpen = ref(false);
const linkKind = ref<"issue" | "pr">("issue");
const linkUrl = ref("");

const openLinkDialog = (kind: "issue" | "pr") => {
  closeMenu();
  linkKind.value = kind;
  linkUrl.value = "";
  linkDialogOpen.value = true;
};

const confirmLink = () => {
  const url = linkUrl.value.trim();
  if (!url) return;
  const number = url.match(/#(\d+)/)?.[1];
  const label = number
    ? `${linkKind.value === "issue" ? "Issue" : "PR"} #${number}`
    : `GitHub ${linkKind.value === "issue" ? "issue" : "PR"}`;
  insertAtCursor(`[${label}](${url})`);
  linkDialogOpen.value = false;
};
</script>

<template>
  <div class="composer">
    <FileRefPicker :open="pickerOpen" v-model:query="pickerQuery" @select="onPickFile" />
    <textarea
      ref="inputEl"
      v-model="draft"
      class="composer__input"
      placeholder="@ for files/agents; / for commands and skills; ! for shell; # for snippets"
      rows="1"
      @input="detectAtRef"
      @keydown="onKeydown"
      @keyup="onKeyup"
      @click="detectAtRef"
    />
    <div class="composer__footer">
      <div class="composer__footer-leading">
        <div ref="attachRoot" class="composer__attach">
          <IconButton
            class="composer__attach-trigger"
            size="compact"
            label="Add attachment"
            :aria-expanded="menuOpen"
            @click="toggleMenu"
          >
            <AddCircleIcon />
          </IconButton>
          <MenuPanel :open="menuOpen" :style="menuStyle" role="menu" aria-label="Composer actions">
            <button type="button" class="menu-item" role="menuitem" @click="openLinkDialog('issue')">
              <GithubIcon />
              Link GitHub Issue
            </button>
            <button type="button" class="menu-item" role="menuitem" @click="openLinkDialog('pr')">
              <GitPullRequestIcon />
              Link GitHub PR
            </button>
          </MenuPanel>
        </div>
        <IconButton size="compact" label="Expand composer"><FullscreenIcon /></IconButton>
        <IconButton size="compact" label="Goal mode"><TargetIcon /></IconButton>
      </div>
      <div class="composer__footer-trailing">
        <div class="composer__models">
          <ModelSelector
            :model="model"
            :available-models="availableModels"
            @select="emit('selectModel', $event)"
          />
          <ThinkingLevelSelector
            :level="thinkingLevel"
            :available-levels="availableThinkingLevels"
            @select="emit('selectThinkingLevel', $event)"
          />
        </div>
        <IconButton size="compact" label="Dictation"><MicIcon /></IconButton>
        <IconButton size="compact" label="Send" :disabled="!canSend" @click="emit('send')">
          <SendIcon />
        </IconButton>
      </div>
    </div>
  </div>

  <Modal size="sm" :show="linkDialogOpen" @close="linkDialogOpen = false">
    <template #body>
      <div class="link-dialog">
        <!-- Modal size=sm already left-aligns body content. Header +
             helper copy follow openchamber's Link GitHub Issue dialog. -->
        <header class="link-dialog__header">
          <h3 class="link-dialog__title">
            Link GitHub {{ linkKind === "issue" ? "Issue" : "Pull Request" }}
          </h3>
          <p class="link-dialog__subtitle">
            Paste the URL — we'll derive the label from the issue or PR number.
          </p>
        </header>
        <input
          v-model="linkUrl"
          class="link-dialog__input"
          type="url"
          autofocus
          :placeholder="
            linkKind === 'issue'
              ? 'https://github.com/owner/repo/issues/123'
              : 'https://github.com/owner/repo/pull/123'
          "
          aria-label="GitHub URL"
          @keydown.enter="confirmLink"
        />
        <div class="link-dialog__actions">
          <button type="button" class="link-dialog__btn" @click="linkDialogOpen = false">Cancel</button>
          <button
            type="button"
            class="link-dialog__btn link-dialog__btn--primary"
            :disabled="!linkUrl.trim()"
            @click="confirmLink"
          >
            Insert link
          </button>
        </div>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.composer {
  position: relative; /* anchor for the upward file-ref picker */
  display: flex;
  flex-direction: column;
  width: min(
    calc(100% - var(--conversation-inline-gutter) - var(--conversation-inline-gutter)),
    var(--conversation-content-width)
  );
  overflow: visible;
  border: 1px solid #dedbd2;
  border-radius: 13px;
}
.composer__input {
  display: block;
  flex: 0 0 auto;
  width: 100%;
  min-height: 52px;
  max-height: 204px;
  field-sizing: content;
  box-sizing: border-box;
  padding: 16px 12px 8px;
  border: 0;
  border-radius: 13px 13px 0 0;
  outline: 0;
  overflow-x: hidden;
  overflow-y: auto;
  resize: none;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  background: transparent;
}
.composer__input::placeholder {
  color: #747474;
}
.composer__footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
}
.composer__footer-leading,
.composer__footer-trailing,
.composer__models {
  display: flex;
  align-items: center;
}
.composer__attach {
  position: relative;
  display: inline-flex;
}
.composer__footer-leading {
  flex: 0 0 auto;
  gap: 6px;
}
.composer__footer-trailing {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.composer__models {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
  gap: 4px;
}

/* GitHub link dialog (rendered through Modal; scoped classes match since
 * Modal's body slot is inlined in this component's template). The
 * dialog is a quiet form: the primary action uses the same warm-amber
 * tint we apply to the git panel's Commit button so the two "commit
 * intent" surfaces feel related without inventing a separate palette. */
.link-dialog {
  display: grid;
  gap: 14px;
}
.link-dialog__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.link-dialog__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #171717;
}
.link-dialog__subtitle {
  margin: 0;
  color: #888;
  font-size: 13px;
  line-height: 1.45;
}
.link-dialog__input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #e7e4dc;
  border-radius: 10px;
  outline: 0;
  color: inherit;
  font: inherit;
  font-size: 13px;
  background: #fff;
  transition: border-color 120ms ease;
}
.link-dialog__input:focus {
  border-color: #bcbcbc;
}
.link-dialog__input::placeholder {
  color: #999;
}
.link-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.link-dialog__btn {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.link-dialog__btn:hover:not(:disabled) {
  background: rgb(0 0 0 / 5%);
}
.link-dialog__btn--primary {
  background: #f3ece4;
  color: #6b4a2e;
  font-weight: 500;
}
.link-dialog__btn--primary:hover:not(:disabled) {
  background: #ebe2d6;
}
.link-dialog__btn:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
