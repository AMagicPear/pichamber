<script setup lang="ts">
import AiAgentIcon from "lucide-static/icons/bot.svg";
import StackIcon from "@/assets/icons/Stack.svg";
import TerminalBoxIcon from "lucide-static/icons/square-terminal.svg";
import ContextIcon from "lucide-static/icons/square-text.svg";
import FolderIcon from "lucide-static/icons/folder.svg";
import GitBranchIcon from "lucide-static/icons/git-branch.svg";
import IconButton from "@/components/ui/IconButton.vue";
import FloatingPanel from "@/components/ui/FloatingPanel.vue";
import ProviderQuotaPanel from "@/components/ui/ProviderQuotaPanel.vue";
import { usePopover } from "@/composables/usePopover";
import { availableModels, windowTitle, workspace } from "@/stores/workspace";
import { getQuotaProviders, loadQuotaProviders } from "@/stores/quota";
import { computed, onMounted, ref } from "vue";
import { activeGitBranch, loadGitBranch } from "@/stores/git";
import { ui } from "@/stores/ui";

const gitBranch = activeGitBranch;

/** At least one quoted provider is configured when the Pi SDK reports a
 *  provider that the server registry also supports. Loads the supported
 *  list once on mount so the button doesn't flicker. */
const hasQuotedProvider = computed(() => {
  const supported = new Set(getQuotaProviders().value.map((p) => p.id));
  return availableModels.value.some((model) => supported.has(model.provider));
});

onMounted(() => {
  void loadQuotaProviders();
  void loadGitBranch();
});

const root = ref<HTMLElement | null>(null);
const { open, style, toggle, panelId } = usePopover({
  root,
  trigger: ".providers-button",
  panel: ".floating-panel",
  width: 280,
});
const onProvidersClick = () => {
  if (!hasQuotedProvider.value) return;
  toggle();
};
</script>

<template>
  <header class="session-header" :class="{ 'is-left-collapsed': !ui.panels.left.open }">
    <div class="session-header__leading">
      <div class="session-header__title">
        <div class="session-header__title-row">
          <h1 :title="workspace.sessionName ?? undefined">{{ workspace.sessionName }}</h1>
          <span v-if="windowTitle" class="session-header__window-title" :title="windowTitle">{{ windowTitle }}</span>
        </div>
        <div class="session-header__path-row">
          <p :title="workspace.cwd ?? undefined">{{ workspace.cwd }}</p>
          <span v-if="gitBranch" class="session-header__branch" :title="`Git branch: ${gitBranch}`">
            <GitBranchIcon />
            {{ gitBranch }}
          </span>
        </div>
      </div>
    </div>

    <nav class="session-header__tools" aria-label="Session tools">
      <div ref="root" class="providers-trigger">
        <IconButton class="providers-button" label="Usage & balance"
          :title="hasQuotedProvider ? 'View usage & balance' : 'No supported providers configured'" :pressed="open"
          :disabled="!hasQuotedProvider" @click="onProvidersClick">
          <StackIcon />
        </IconButton>
        <FloatingPanel :open="open" :style="style" :width="280" :panel-id="panelId" aria-label="Usage & balance">
          <ProviderQuotaPanel :open="open" />
        </FloatingPanel>
      </div>
      <IconButton label="Toggle terminal panel" :pressed="ui.panels.bottom.open" @click="ui.toggle('bottom')">
        <TerminalBoxIcon />
      </IconButton>
      <IconButton label="Git panel" :pressed="ui.panels.right.open && ui.activeRightPanel === 'git'"
        @click="ui.selectRightPanel('git')">
        <GitBranchIcon />
      </IconButton>
      <IconButton label="Files panel" :pressed="ui.panels.right.open && ui.activeRightPanel === 'files'"
        @click="ui.selectRightPanel('files')">
        <FolderIcon />
      </IconButton>
      <IconButton label="Context panel" :pressed="ui.panels.right.open && ui.activeRightPanel === 'context'"
        @click="ui.selectRightPanel('context')">
        <ContextIcon />
      </IconButton>
    </nav>
  </header>
</template>

<style scoped>
.session-header {
  display: flex;
  flex: 0 0 50px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.session-header.is-left-collapsed {
  padding-left: 48px;
}

.session-header__leading,
.session-header__tools {
  display: flex;
  align-items: center;
}

.session-header__leading {
  flex: 1 1 auto;
  min-width: 0;
  gap: 8px;
}

.session-header__title {
  min-width: 0;
}

.session-header__title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.session-header__title-row h1 {
  flex: 0 1 auto;
  min-width: 0;
}

/* Extension-set terminal window/tab title (ctx.ui.setTitle). Lives next
 * to the session name as a separate badge — never replaces it: the
 * session name is persisted session metadata, the window title is an
 * ephemeral host-window label that extensions may update frequently
 * (e.g. titlebar-spinner animates it). */
.session-header__window-title {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 240px;
  overflow: hidden;
  padding: 1px 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 999px;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-header h1,
.session-header p {
  margin: 0;
}

.session-header__path-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.session-header__branch {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  max-width: 180px;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-header__branch svg {
  width: 12px;
  height: 12px;
}

.session-header h1 {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-header p {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-header__tools {
  gap: 8px;
}

.account-icon {
  width: 22px;
  height: 22px;
}

/* Wraps the trigger so `usePopover` can scope its outside-click
 * listener to the same element the trigger lives in. */
.providers-trigger {
  display: inline-flex;
}
</style>
