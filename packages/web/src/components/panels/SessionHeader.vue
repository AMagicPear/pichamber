<script setup lang="ts">
import AiAgentIcon from "@/assets/icons/AiAgent.svg";
import GlobalIcon from "@/assets/icons/Global.svg";
import LayoutLeftIcon from "@/assets/icons/LayoutLeft.svg";
import LayoutRightIcon from "@/assets/icons/LayoutRight.svg";
import StackIcon from "@/assets/icons/Stack.svg";
import TerminalBoxIcon from "@/assets/icons/TerminalBox.svg";
import IconButton from "@/components/IconButton.vue";
import MenuPanel from "@/components/MenuPanel.vue";
import ProviderQuotaPanel from "@/components/workspace/ProviderQuotaPanel.vue";
import { useConversationSession } from "@/composables/useConversationSession";
import { usePopover } from "@/composables/usePopover";
import { getQuotaProviders, loadQuotaProviders } from "@/stores/quota";
import { computed, onMounted, ref } from "vue";
import { ui } from "@/stores/ui";
import { workspace } from "@/stores/workspace";

const { availableModels } = useConversationSession();

/** At least one quoted provider is configured when the Pi SDK reports a
 *  provider that the server registry also supports. Loads the supported
 *  list once on mount so the button doesn't flicker. */
const hasQuotedProvider = computed(() => {
  const supported = new Set(getQuotaProviders().value.map((p) => p.id));
  return availableModels.value.some((model) => supported.has(model.provider));
});

onMounted(() => {
  void loadQuotaProviders();
});

const root = ref<HTMLElement | null>(null);
const { open, style, toggle } = usePopover({
  root,
  trigger: ".providers-button",
  panel: ".menu-panel",
  width: 280,
  height: 0,
});
const onProvidersClick = () => {
  if (!hasQuotedProvider.value) return;
  toggle();
};
</script>

<template>
  <header
    class="session-header"
    :class="{ 'is-left-collapsed': !ui.panels.left.open }"
  >
    <div class="session-header__leading">
      <div class="session-header__title">
          <h1 :title="workspace.sessionName ?? undefined">{{ workspace.sessionName }}</h1>
          <p :title="workspace.cwd ?? undefined">{{ workspace.cwd }}</p>
      </div>
    </div>

    <nav class="session-header__tools" aria-label="Session tools">
      <div ref="root" class="providers-trigger">
        <IconButton
          class="providers-button"
          label="Token plan usage"
          :title="hasQuotedProvider ? 'View token plan usage' : 'No supported providers configured'"
          :pressed="open"
          :disabled="!hasQuotedProvider"
          @click="onProvidersClick"
        >
          <StackIcon />
        </IconButton>
        <MenuPanel :open="open" :style="style" :width="280" aria-label="Token plan usage">
          <ProviderQuotaPanel :open="open" />
        </MenuPanel>
      </div>
      <IconButton
        label="Toggle terminal panel"
        :pressed="ui.panels.bottom.open"
        @click="ui.toggle('bottom')"
      >
        <TerminalBoxIcon />
      </IconButton>
      <IconButton label="Web" disabled><GlobalIcon /></IconButton>
      <IconButton
        label="Toggle right sidebar"
        :pressed="ui.panels.right.open"
        @click="ui.toggle('right')"
      >
        <LayoutRightIcon />
      </IconButton>
      <IconButton label="Account" disabled><AiAgentIcon class="account-icon" /></IconButton>
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
.session-header h1,
.session-header p {
  margin: 0;
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