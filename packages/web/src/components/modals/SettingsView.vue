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

defineOptions({ name: "SettingsView" });

const emit = defineEmits<{ close: [] }>();

interface NavItem {
  key: string;
  label: string;
  icon: unknown;
}

const navItems: NavItem[] = [
  { key: "appearance", label: "Appearance", icon: PaletteIcon },
  { key: "chat", label: "Chat", icon: ChatAi3Icon },
  { key: "notifications", label: "Notifications", icon: Notification3Icon },
  { key: "sessions", label: "Sessions", icon: ChatHistoryIcon },
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
  { key: "plugins", label: "Plugins", icon: CodeBoxIcon },
  { key: "providers", label: "Providers", icon: CloudIcon },
  { key: "usage", label: "Usage", icon: BarChart2Icon },
  { key: "skills-installed", label: "Skills", icon: BookOpenIcon },
  { key: "skills-catalog", label: "Skills Catalog", icon: BookIcon },
];

const activeKey = ref<string>("home");
const searchQuery = ref("");
const settingsSize = ref(216);

const visibleNavItems = computed(() =>
  navItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.value.trim().toLowerCase()),
  ),
);

interface HomeCard {
  key: string;
  title: string;
  description: string;
}

const homeCards: HomeCard[] = [
  { key: "providers", title: "Providers", description: "Connect models + credentials" },
  { key: "agents", title: "Agents", description: "Prompts, tools, permissions" },
  { key: "skills-catalog", title: "Skills Catalog", description: "Install skills from catalogs" },
  { key: "mcp", title: "MCP", description: "Configure MCP servers + connections" },
  { key: "usage", title: "Usage", description: "Quota + spend visibility" },
];

const selectItem = (key: string) => {
  activeKey.value = key;
};

const openHomeCard = (key: string) => {
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
            <button type="button" @click="selectItem(item.key)">
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
          <template v-if="activeKey === 'sessions'">
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
          <template v-else>
          <header class="settings-page__heading">
            <h1>Settings</h1>
            <p>Jump to common pages.</p>
          </header>

          <div class="settings-page__cards">
            <button
              v-for="card in homeCards"
              :key="card.key"
              type="button"
              class="settings-card"
              @click="openHomeCard(card.key)"
            >
              <span class="settings-card__title">{{ card.title }}</span>
              <span class="settings-card__description">{{ card.description }}</span>
            </button>
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
  background: #fff;
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
  border: 1px solid #dfddd4;
  border-radius: 8px;
  background: #fff;
  color: #888;
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
  color: #999;
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
  transition: background-color 120ms ease;
}
.settings-nav__list button svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: #777;
}
.settings-nav__list button:hover {
  background: rgba(0, 0, 0, 0.04);
}
.settings-nav__list .is-active button {
  background: rgba(0, 0, 0, 0.06);
}
.settings-nav__list .is-active button svg {
  color: #171717;
}
.settings-nav__empty {
  padding: 14px 12px;
  color: #888;
  font-size: 13px;
  text-align: center;
}

.settings-page {
  position: relative;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  background: #fff;
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
  color: #222;
  cursor: pointer;
}
.settings-option input {
  width: 16px;
  height: 16px;
  margin: 2px 0 0;
  accent-color: #222;
}
.settings-option span {
  display: grid;
  gap: 4px;
}
.settings-option strong {
  font-weight: 500;
}
.settings-option small {
  color: #888;
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
  color: #777;
  font-size: 14px;
}
.settings-page__cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  max-width: 720px;
}
.settings-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid #eeeae1;
  border-radius: 10px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.settings-card:hover {
  background: rgba(0, 0, 0, 0.03);
}
.settings-card__title {
  font-size: 14px;
  font-weight: 600;
}
.settings-card__description {
  color: #888;
  font-size: 12px;
}
</style>
