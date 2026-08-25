<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue";
import { useI18n } from "vue-i18n";
import SplitPane from "@/components/shell/SplitPane.vue";
import IconButton from "@/components/ui/IconButton.vue";
import SearchBox from "@/components/ui/SearchBox.vue";
import AiAgentIcon from "lucide-static/icons/bot.svg";
import AiGenerate2Icon from "lucide-static/icons/sparkles.svg";
import BookOpenIcon from "lucide-static/icons/book-open.svg";
import BookIcon from "lucide-static/icons/book.svg";
import BrainIcon from "lucide-static/icons/brain.svg";
import ChatAi3Icon from "lucide-static/icons/message-square-text.svg";
import ChatHistoryIcon from "lucide-static/icons/messages-square.svg";
import ChatThreadIcon from "lucide-static/icons/messages-square.svg";
import CloseIcon from "lucide-static/icons/x.svg";
import CloudIcon from "lucide-static/icons/cloud.svg";
import CodeBoxIcon from "lucide-static/icons/code.svg";
import CommandIcon from "lucide-static/icons/command.svg";
import FoldersIcon from "lucide-static/icons/folders.svg";
import GitBranchIcon from "lucide-static/icons/git-branch.svg";
import Notification3Icon from "lucide-static/icons/bell-ring.svg";
import PaletteIcon from "lucide-static/icons/palette.svg";
import FileCodeIcon from "lucide-static/icons/file-code.svg";
import ServerIcon from "lucide-static/icons/server.svg";
import SlashCommands2Icon from "lucide-static/icons/square-asterisk.svg";
import McpIcon from "@/assets/icons/MCP.svg";
import { settings } from "@/stores/settings";
import { preference as themePreference, setTheme, themeOptions } from "@/stores/theme";
import { localeOptions, localePreference, setLocale } from "@/i18n";
import { persistedState } from "@/stores/persisted";
import PiBehaviorSettings from "@/components/modals/settings/PiBehaviorSettings.vue";
import RuntimeSettings from "@/components/modals/settings/RuntimeSettings.vue";
import PiProvidersSettings from "@/components/modals/settings/PiProvidersSettings.vue";
import SettingsGroup from "@/components/modals/settings/SettingsGroup.vue";
import SettingsOption from "@/components/modals/settings/SettingsOption.vue";
import SettingsPageHeader from "@/components/modals/settings/SettingsPageHeader.vue";
import ExtensionsManager from "@/components/modals/settings/ExtensionsManager.vue";
import { fetchFileEditor, updateFileEditor, type FileEditor } from "@/api/client";

defineOptions({ name: "SettingsView" });

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

interface NavItem {
  key: string;
  label: () => string;
  icon: unknown;
  enabled?: boolean;
}

const navItems: NavItem[] = [
  { key: "appearance", label: () => t("settings.nav.appearance"), icon: PaletteIcon, enabled: true },
  { key: "editor", label: () => t("settings.nav.editor"), icon: FileCodeIcon, enabled: true },
  { key: "chat", label: () => t("settings.nav.chat"), icon: ChatAi3Icon, enabled: true },
  { key: "notifications", label: () => t("settings.nav.notifications"), icon: Notification3Icon, enabled: true },
  { key: "sessions", label: () => t("settings.nav.sessions"), icon: ChatHistoryIcon, enabled: true },
  { key: "shortcuts", label: () => t("settings.nav.shortcuts"), icon: CommandIcon },
  { key: "git", label: () => "Git", icon: GitBranchIcon, enabled: true },
  { key: "magic-prompts", label: () => t("settings.nav.magicPrompts"), icon: AiGenerate2Icon },
  { key: "snippets", label: () => t("settings.nav.snippets"), icon: ChatThreadIcon },
  { key: "projects", label: () => t("settings.nav.projects"), icon: FoldersIcon },
  { key: "remote-instances", label: () => t("settings.nav.remoteInstances"), icon: ServerIcon },
  { key: "agents", label: () => t("settings.nav.agents"), icon: AiAgentIcon },
  { key: "behavior", label: () => t("settings.nav.behavior"), icon: BrainIcon, enabled: true },
  { key: "runtime", label: () => t("settings.nav.runtime"), icon: ServerIcon, enabled: true },
  { key: "commands", label: () => t("settings.nav.commands"), icon: SlashCommands2Icon },
  { key: "mcp", label: () => "MCP", icon: McpIcon },
  { key: "extensions", label: () => t("settings.nav.extensions"), icon: CodeBoxIcon, enabled: true },
  { key: "providers", label: () => t("settings.nav.providers"), icon: CloudIcon, enabled: true },
  { key: "skills-installed", label: () => t("settings.nav.skills"), icon: BookOpenIcon },
  { key: "skills-catalog", label: () => t("settings.nav.skillsCatalog"), icon: BookIcon },
];

type SettingsViewState = { activeKey: string; size: number };
const settingsView = persistedState<SettingsViewState>("pichamber.settings-view.v1", {
  activeKey: "appearance",
  size: 216,
}, (raw) => ({
  activeKey: navItems.some((item) => item.key === raw.activeKey) ? raw.activeKey! : "appearance",
  size: typeof raw.size === "number" && Number.isFinite(raw.size)
    ? Math.min(280, Math.max(176, raw.size))
    : 216,
}));
const activeKey = toRef(settingsView, "activeKey");
const searchQuery = ref("");
const settingsSize = toRef(settingsView, "size");
const fileEditor = ref<FileEditor>("vscode");
onMounted(async () => {
  try {
    fileEditor.value = (await fetchFileEditor()).fileEditor;
  } catch {
    // Keep the default while the server is unavailable.
  }
});
const saveFileEditor = async (value: FileEditor) => {
  try {
    fileEditor.value = (await updateFileEditor(value)).fileEditor;
  } catch {
    // The select remains on the last confirmed server value.
  }
};

// Desktop-notification permission is a tristate of "we don't know yet",
// "the user said yes/no", or "this browser can't show notifications".
// We refresh on mount and after a successful request; some browsers
// silently downgrade "default" to "denied" between sessions, so a quick
// re-read avoids the toggle getting stuck enabled.
type NotificationStatus = "unsupported" | NotificationPermission;
const notificationStatus = ref<NotificationStatus>(
  typeof Notification === "undefined" ? "unsupported" : Notification.permission,
);
const refreshNotificationStatus = () => {
  if (typeof Notification === "undefined") return;
  notificationStatus.value = Notification.permission;
};
onMounted(refreshNotificationStatus);
const canDesktopNotify = computed(() => notificationStatus.value === "granted");

const requestNotificationPermission = async () => {
  if (typeof Notification === "undefined") return;
  if (notificationStatus.value === "granted" || notificationStatus.value === "denied") return;
  const next = await Notification.requestPermission();
  notificationStatus.value = next;
};

/** Match the user-visible state to "what does the button actually do".
 *  Read-only labels when permission is already decided so the row stays
 *  calm once granted/denied. */
const permissionLabel = computed(() => {
  const status = notificationStatus.value;
  if (status === "unsupported") {
    return {
      title: t("settings.notifications.unsupportedTitle"),
      description: t("settings.notifications.unsupportedDesc"),
      action: t("settings.notifications.unsupportedAction"),
      disabled: true,
    };
  }
  if (status === "granted") {
    return {
      title: t("settings.notifications.allowedTitle"),
      description: t("settings.notifications.allowedDesc"),
      action: t("settings.notifications.allowedAction"),
      disabled: true,
    };
  }
  if (status === "denied") {
    return {
      title: t("settings.notifications.blockedTitle"),
      description: t("settings.notifications.blockedDesc"),
      action: t("settings.notifications.blockedAction"),
      disabled: true,
    };
  }
  return {
    title: t("settings.notifications.requestTitle"),
    description: t("settings.notifications.requestDesc"),
    action: t("settings.notifications.requestAction"),
    disabled: false,
  };
});

const visibleNavItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return navItems;
  return navItems.filter((item) => item.label().toLowerCase().includes(query));
});

const selectItem = (key: string) => {
  activeKey.value = key;
};
</script>

<template>
  <SplitPane
    mode="left"
    :size="settingsSize"
    :min-size="176"
    :max-size="280"
    @update:size="settingsSize = $event"
  >
    <template #sidebar>
      <aside class="settings-nav">
        <SearchBox v-model="searchQuery" :placeholder="t('settings.searchPlaceholder')" :label="t('settings.search')" />

        <ul class="settings-nav__list">
          <li
            v-for="item in visibleNavItems"
            :key="item.key"
            :class="{ 'is-active': activeKey === item.key }"
          >
            <button type="button" :disabled="!item.enabled" @click="selectItem(item.key)">
              <component :is="item.icon" />
              <span>{{ item.label() }}</span>
            </button>
          </li>
          <li v-if="visibleNavItems.length === 0" class="settings-nav__empty">
            <span>{{ t('settings.noMatches') }}</span>
          </li>
        </ul>
      </aside>
    </template>

    <template #default>
      <section class="settings-page">
        <div class="settings-page__close">
          <IconButton size="compact" :label="t('settings.closeSettings')" @click="emit('close')">
            <CloseIcon />
          </IconButton>
        </div>

        <div class="settings-page__body">
          <template v-if="activeKey === 'appearance'">
            <SettingsPageHeader :title="t('settings.appearance.title')" :description="t('settings.appearance.description')" />

            <SettingsGroup :title="t('settings.appearance.themeTitle')">
              <div class="theme-options" role="radiogroup" :aria-label="t('settings.appearance.themeTitle')">
                <button
                  v-for="option in themeOptions"
                  :key="option.id"
                  type="button"
                  role="radio"
                  :aria-checked="themePreference === option.id"
                  :class="{ 'is-active': themePreference === option.id }"
                  @click="setTheme(option.id)"
                >
                  <span class="theme-options__preview" :class="`is-${option.id}`"><i /><i /></span>
                  <span><strong>{{ t(option.labelKey) }}</strong><small>{{ t(option.descriptionKey) }}</small></span>
                </button>
              </div>
            </SettingsGroup>

            <SettingsGroup :title="t('settings.appearance.languageTitle')" class="language-group">
              <div class="language-options" role="radiogroup" :aria-label="t('settings.appearance.languageTitle')">
                <button
                  v-for="option in localeOptions"
                  :key="option.id"
                  type="button"
                  role="radio"
                  :aria-checked="localePreference() === option.id"
                  :class="{ 'is-active': localePreference() === option.id }"
                  @click="setLocale(option.id)"
                >
                  <span><strong>{{ "label" in option ? option.label : t(option.labelKey) }}</strong></span>
                </button>
              </div>
            </SettingsGroup>
          </template>

          <template v-else-if="activeKey === 'sessions'">
            <SettingsPageHeader :title="t('settings.sessions.title')" :description="t('settings.sessions.description')" />

            <SettingsOption :title="t('settings.sessions.hideTemporary')" :description="t('settings.sessions.hideTemporaryDesc')">
              <input v-model="settings.hideTemporarySessions" type="checkbox" />
            </SettingsOption>
          </template>

          <template v-else-if="activeKey === 'editor'">
            <SettingsPageHeader :title="t('settings.editor.title')" :description="t('settings.editor.description')" />

            <SettingsGroup :title="t('settings.editor.localFileLinks')">
              <SettingsOption inline :title="t('settings.editor.openFilesWith')" :description="t('settings.editor.openFilesWithDesc')">
                <select :value="fileEditor" @change="saveFileEditor(($event.target as HTMLSelectElement).value as FileEditor)">
                  <option value="vscode">VS Code (default)</option>
                  <option value="cursor">Cursor</option>
                  <option value="zed">Zed</option>
                  <option value="webstorm">WebStorm</option>
                  <option value="system">{{ t('settings.editor.systemDefault') }}</option>
                </select>
              </SettingsOption>
            </SettingsGroup>
          </template>

          <template v-else-if="activeKey === 'chat'">
            <SettingsPageHeader :title="t('settings.chat.title')" :description="t('settings.chat.description')" />

            <SettingsGroup :title="t('settings.chat.composer')">
              <SettingsOption inline :title="t('settings.chat.sendKey')" :description="t('settings.chat.sendKeyDesc')">
                <select v-model="settings.sendKey">
                  <option value="enter">{{ t('settings.chat.sendKeyEnter') }}</option>
                  <option value="modEnter">{{ t('settings.chat.sendKeyModEnter') }}</option>
                </select>
              </SettingsOption>
            </SettingsGroup>

            <SettingsGroup :title="t('settings.chat.display')">
              <SettingsOption :title="t('settings.chat.showTimestamps')" :description="t('settings.chat.showTimestampsDesc')">
                <input v-model="settings.showTimestamps" type="checkbox" />
              </SettingsOption>
              <SettingsOption :title="t('settings.chat.expandToolResults')" :description="t('settings.chat.expandToolResultsDesc')">
                <input v-model="settings.expandedToolResults" type="checkbox" />
              </SettingsOption>
            </SettingsGroup>
          </template>

          <template v-else-if="activeKey === 'notifications'">
            <SettingsPageHeader :title="t('settings.notifications.title')" :description="t('settings.notifications.description')" />

            <SettingsGroup :title="t('settings.notifications.onTurnComplete')">
              <SettingsOption :title="t('settings.notifications.sound')" :description="t('settings.notifications.soundDesc')">
                <input v-model="settings.notifySound" type="checkbox" />
              </SettingsOption>
              <SettingsOption :title="t('settings.notifications.desktopNotification')" :description="t('settings.notifications.desktopNotificationDesc')">
                <input v-model="settings.notifyDesktop" type="checkbox" :disabled="!canDesktopNotify" />
              </SettingsOption>
            </SettingsGroup>

            <SettingsGroup :title="t('settings.notifications.browserPermission')">
              <SettingsOption
                inline
                :title="permissionLabel.title"
                :description="permissionLabel.description"
              >
                <button
                  type="button"
                  class="settings-permission-button"
                  :disabled="permissionLabel.disabled"
                  @click="requestNotificationPermission"
                >{{ permissionLabel.action }}</button>
              </SettingsOption>
            </SettingsGroup>
          </template>

          <template v-else-if="activeKey === 'git'">
            <SettingsPageHeader title="Git" :description="t('settings.git.description')" />

            <SettingsGroup :title="t('settings.git.remoteUpdates')">
              <SettingsOption :title="t('settings.git.autoFetch')" :description="t('settings.git.autoFetchDesc')">
                <input v-model="settings.gitAutoFetch" type="checkbox" />
              </SettingsOption>
            </SettingsGroup>
          </template>

          <template v-else-if="activeKey === 'extensions'">
            <SettingsPageHeader :title="t('settings.extensions.title')" :description="t('settings.extensions.description')" />
            <ExtensionsManager />
          </template>

          <PiProvidersSettings v-else-if="activeKey === 'providers'" />

          <PiBehaviorSettings v-else-if="activeKey === 'behavior'" />
          <RuntimeSettings v-else-if="activeKey === 'runtime'" />
        </div>
      </section>
    </template>
  </SplitPane>
</template>

<style scoped>
.settings-nav {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  background: var(--ui-surface);
  font-size: 14px;
}
.settings-nav > :deep(.search-box) {
  margin: 12px 10px 4px;
}


.settings-nav__list {
  flex: 1 1 0;
  min-height: 0;
  list-style: none;
  margin: 0;
  padding: 8px 8px 0;
  overflow-y: auto;
}
.settings-nav__list li {
  margin: 0;
}
.settings-nav__list button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  color: inherit;
  font-size: 14px;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--ui-duration-fast) var(--ui-ease-standard);
}
.settings-nav__list button svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--ui-text-muted);
}
.settings-nav__list button:hover:not(:disabled) {
  background: var(--ui-surface-hover);
}
.settings-nav__list button:disabled {
  cursor: default;
  opacity: 0.45;
}
.settings-nav__list .is-active button {
  background: var(--ui-surface-selected);
}
.settings-nav__list .is-active button svg {
  color: var(--ui-text-strong);
}
.settings-nav__empty {
  padding: 14px 12px;
  color: var(--ui-text-muted);
  font-size: 13px;
  text-align: center;
}

.settings-page {
  position: relative;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  background: var(--ui-surface);
}
.settings-page__close {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1;
}
.settings-page__body {
  flex: 1 1 0;
  min-height: 0;
  padding: 24px 32px;
  overflow-y: auto;
}
.theme-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.theme-options > button { display: grid; min-width: 0; gap: 9px; padding: 10px; border: 1px solid var(--ui-border-subtle); border-radius: 8px; background: var(--ui-surface); text-align: left; transition: border-color var(--ui-duration-fast) var(--ui-ease-standard), background-color var(--ui-duration-fast) var(--ui-ease-standard); }
.theme-options > button:hover { background: var(--ui-surface-hover); }
.theme-options > button.is-active { border-color: var(--ui-border-focus); background: var(--ui-surface-selected); }
.theme-options > button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.theme-options > button > span:last-child { display: grid; min-width: 0; gap: 2px; }
.theme-options strong { color: var(--ui-text-strong); font-size: 13px; font-weight: 500; }
.theme-options small { color: var(--ui-text-muted); font-size: 11px; line-height: 1.35; }
.theme-options__preview { position: relative; display: block; height: 44px; overflow: hidden; border: 1px solid #d9d6ce; border-radius: 6px; background: #f7f6f2; }
.theme-options__preview::before { position: absolute; inset: 0 auto 0 0; width: 28%; border-right: 1px solid #dedbd2; background: #efede7; content: ""; }
.theme-options__preview i { position: absolute; left: 36%; right: 8%; height: 5px; border-radius: 2px; background: #d5d1c8; }
.theme-options__preview i:first-child { top: 12px; right: 28%; }
.theme-options__preview i:last-child { top: 23px; }
.theme-options__preview.is-dark { border-color: #403f3b; background: #222220; }
.theme-options__preview.is-dark::before { border-color: #44433f; background: #2a2a27; }
.theme-options__preview.is-dark i { background: #565550; }
.theme-options__preview.is-system { background: linear-gradient(135deg, #f7f6f2 0 49.5%, #222220 50%); }
.theme-options__preview.is-system::before { background: linear-gradient(135deg, #efede7 0 49.5%, #2a2a27 50%); }
.theme-options__preview.is-system i { background: linear-gradient(135deg, #d5d1c8 0 49.5%, #565550 50%); }
@media (max-width: 700px) { .theme-options { grid-template-columns: 1fr; } }

/* Language picker: simple text pills, no preview tiles needed. */
.language-group { margin-top: 22px; }
.language-options { display: flex; flex-wrap: wrap; gap: 8px; }
.language-options > button { display: inline-flex; align-items: center; padding: 6px 14px; border: 1px solid var(--ui-border-subtle); border-radius: 999px; background: var(--ui-surface); color: var(--ui-text-muted); font-size: 13px; transition: border-color var(--ui-duration-fast) var(--ui-ease-standard), background-color var(--ui-duration-fast) var(--ui-ease-standard); }
.language-options > button:hover { background: var(--ui-surface-hover); }
.language-options > button.is-active { border-color: var(--ui-border-focus); background: var(--ui-surface-selected); color: var(--ui-text-strong); }
.language-options > button:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; }
.language-options strong { font-weight: 500; }

/* Permission button: matches the input/select control surface so the
 * inline option row stays visually balanced. Disabled reads muted so
 * "Granted" / "Denied" / "Unavailable" don't pull focus. */
.settings-permission-button {
  min-width: 132px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.settings-permission-button:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
