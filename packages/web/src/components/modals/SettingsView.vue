<script setup lang="ts">
import { computed, ref } from "vue";
import SplitPane from "@/components/layout/SplitPane.vue";
import IconButton from "@/components/IconButton.vue";
import AiAgentIcon from "@/assets/icons/AiAgent.svg";
import AiGenerate2Icon from "@/assets/icons/AiGenerate2.svg";
import BarChart2Icon from "@/assets/icons/BarChart2.svg";
import BookOpenIcon from "@/assets/icons/BookOpen.svg";
import BookIcon from "@/assets/icons/Book.svg";
import BrainIcon from "@/assets/icons/Brain.svg";
import ChatAi3Icon from "@/assets/icons/ChatAi3.svg";
import ChatHistoryIcon from "@/assets/icons/ChatHistory.svg";
import ChatThreadIcon from "@/assets/icons/ChatThread.svg";
import CloseIcon from "@/assets/icons/Close.svg";
import CloudIcon from "@/assets/icons/Cloud.svg";
import CodeBoxIcon from "@/assets/icons/CodeBox.svg";
import CommandIcon from "@/assets/icons/Command.svg";
import FoldersIcon from "@/assets/icons/Folders.svg";
import GitBranchIcon from "@/assets/icons/GitBranch.svg";
import GlobalIcon from "@/assets/icons/Global.svg";
import Notification3Icon from "@/assets/icons/Notification3.svg";
import PaletteIcon from "@/assets/icons/Palette.svg";
import SearchIcon from "@/assets/icons/Search.svg";
import ServerIcon from "@/assets/icons/Server.svg";
import SlashCommands2Icon from "@/assets/icons/SlashCommands2.svg";
import StackIcon from "@/assets/icons/Stack.svg";
import { McpIcon } from "@/components/McpIcon";
import { settings } from "@/stores/settings";
import { useConversationSession } from "@/composables/useConversationSession";
import { useTheme } from "@/composables/useTheme";

defineOptions({ name: "SettingsView" });

const emit = defineEmits<{ close: [] }>();

interface NavItem {
  key: string;
  label: string;
  icon: unknown;
  enabled?: boolean;
}

const navItems: NavItem[] = [
  { key: "appearance", label: "Appearance", icon: PaletteIcon, enabled: true },
  { key: "chat", label: "Chat", icon: ChatAi3Icon },
  { key: "notifications", label: "Notifications", icon: Notification3Icon },
  { key: "sessions", label: "Sessions", icon: ChatHistoryIcon, enabled: true },
  { key: "shortcuts", label: "Shortcuts", icon: CommandIcon },
  { key: "git", label: "Git", icon: GitBranchIcon },
  { key: "magic-prompts", label: "Magic Prompts", icon: AiGenerate2Icon },
  { key: "snippets", label: "Snippets", icon: ChatThreadIcon },
  { key: "projects", label: "Projects", icon: FoldersIcon },
  { key: "remote-instances", label: "Remote Instances", icon: ServerIcon },
  { key: "agents", label: "Agents", icon: AiAgentIcon },
  { key: "behavior", label: "Behavior", icon: BrainIcon },
  { key: "commands", label: "Commands", icon: SlashCommands2Icon },
  { key: "mcp", label: "MCP", icon: McpIcon },
  { key: "extensions", label: "Extensions", icon: CodeBoxIcon, enabled: true },
  { key: "providers", label: "Providers", icon: CloudIcon },
  { key: "usage", label: "Usage", icon: BarChart2Icon },
  { key: "skills-installed", label: "Skills", icon: BookOpenIcon },
  { key: "skills-catalog", label: "Skills Catalog", icon: BookIcon },
];

const activeKey = ref<string>("appearance");
const searchQuery = ref("");
const settingsSize = ref(216);
const { resources } = useConversationSession();
const { preference: themePreference, options: themeOptions, setTheme } = useTheme();

const visibleNavItems = computed(() =>
  navItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.value.trim().toLowerCase()),
  ),
);

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
        <div class="settings-nav__search">
          <SearchIcon class="settings-nav__search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search settings"
            aria-label="Search settings"
          />
        </div>

        <ul class="settings-nav__list">
          <li
            v-for="item in visibleNavItems"
            :key="item.key"
            :class="{ 'is-active': activeKey === item.key }"
          >
            <button type="button" :disabled="!item.enabled" @click="selectItem(item.key)">
              <component :is="item.icon" />
              <span>{{ item.label }}</span>
            </button>
          </li>
          <li v-if="visibleNavItems.length === 0" class="settings-nav__empty">
            <span>No matches</span>
          </li>
        </ul>
      </aside>
    </template>

    <template #default>
      <section class="settings-page">
        <div class="settings-page__close">
          <IconButton size="compact" label="Close settings" @click="emit('close')">
            <CloseIcon />
          </IconButton>
        </div>

        <div class="settings-page__body">
          <template v-if="activeKey === 'appearance'">
            <header class="settings-page__heading">
              <h1>Appearance</h1>
              <p>Choose how Pichamber looks on this device.</p>
            </header>

            <section class="settings-group">
              <h2>Theme</h2>
              <div class="theme-options" role="radiogroup" aria-label="Theme">
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
                  <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
                </button>
              </div>
            </section>
          </template>

          <template v-else-if="activeKey === 'sessions'">
            <header class="settings-page__heading">
              <h1>Sessions</h1>
              <p>Control which sessions appear in the sidebar.</p>
            </header>

            <label class="settings-option">
              <input v-model="settings.hideTemporarySessions" type="checkbox" />
              <span>
                <strong>Hide temporary sessions</strong>
                <small>Hide sessions under /tmp and macOS temporary folders.</small>
              </span>
            </label>
          </template>

          <template v-else-if="activeKey === 'extensions'">
            <header class="settings-page__heading">
              <h1>Extensions</h1>
              <p>Resources loaded by Pi for the active session.</p>
            </header>

            <div v-if="resources.diagnostics.length" class="extension-diagnostics">
              <article v-for="diagnostic in resources.diagnostics" :key="`${diagnostic.path}:${diagnostic.error}`">
                <strong>{{ diagnostic.path }}</strong>
                <span>{{ diagnostic.error }}</span>
              </article>
            </div>

            <div v-if="resources.extensions.length" class="extension-list">
              <article v-for="extension in resources.extensions" :key="extension.path" class="extension-card">
                <header>
                  <div>
                    <strong>{{ extension.sourceInfo.source }}</strong>
                    <span>{{ extension.sourceInfo.scope }}</span>
                  </div>
                  <small :title="extension.path">{{ extension.path }}</small>
                </header>
                <div v-if="extension.commands.length || extension.tools.length" class="extension-card__resources">
                  <span v-for="command in extension.commands" :key="`command:${command}`">/{{ command }}</span>
                  <span v-for="tool in extension.tools" :key="`tool:${tool}`">{{ tool }}</span>
                </div>
                <p v-else>No commands or tools registered.</p>
              </article>
            </div>
            <div v-else class="extension-empty">
              No extensions are loaded for this session.
            </div>
          </template>
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
.settings-nav__search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin: 12px 10px 4px;
  padding: 0 10px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--ui-text-muted);
}
.settings-nav__search-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.settings-nav__search input {
  flex: 1 1 0;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}
.settings-nav__search input::placeholder {
  color: var(--ui-text-muted);
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
.settings-option {
  display: flex;
  max-width: 560px;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 0;
  color: var(--ui-text-strong);
  cursor: pointer;
}
.settings-option input {
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  accent-color: var(--ui-text-strong);
}
.settings-option span {
  display: grid;
  gap: 4px;
}
.settings-option strong {
  font-weight: 500;
}
.settings-option small {
  color: var(--ui-text-muted);
  font-size: 12px;
}
.settings-page__heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 22px;
}
.settings-page__heading h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
}
.settings-page__heading p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 14px;
}
.settings-group { display: grid; max-width: 720px; gap: 10px; }
.settings-group h2 { margin: 0; color: var(--ui-text-muted); font-size: 12px; font-weight: 500; }
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
.extension-diagnostics,
.extension-list {
  display: grid;
  max-width: 720px;
  gap: 8px;
}
.extension-diagnostics { margin-bottom: 16px; }
.extension-diagnostics article {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  border-left: 3px solid var(--ui-error-strong);
  border-radius: 4px;
  background: var(--ui-error-bg);
  color: var(--ui-error-fg);
  font-size: 12px;
}
.extension-diagnostics strong { overflow-wrap: anywhere; font-weight: 600; }
.extension-card {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 7px;
}
.extension-card header {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.extension-card header div { display: flex; align-items: center; gap: 7px; }
.extension-card header strong { font-size: 13px; font-weight: 600; }
.extension-card header span,
.extension-card header small {
  color: var(--ui-text-muted);
  font-size: 11px;
}
.extension-card header span { padding: 2px 5px; border-radius: 4px; background: var(--ui-surface-selected); }
.extension-card header small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.extension-card__resources { display: flex; flex-wrap: wrap; gap: 5px; }
.extension-card__resources span {
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--ui-extension-bg);
  color: var(--ui-extension-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.extension-card p,
.extension-empty { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
.extension-empty { max-width: 720px; padding: 20px 0; border-top: 1px solid var(--ui-border-subtle); }
</style>
