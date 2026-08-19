<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
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
import TerminalIcon from "@/assets/icons/Terminal.svg";
import { McpIcon } from "@/components/McpIcon";
import { settings } from "@/stores/settings";
import { useConversationSession } from "@/composables/useConversationSession";
import { useTheme } from "@/composables/useTheme";
import { useServerSettings } from "@/stores/server-settings";
import { persistedState } from "@/stores/persisted";
import PiBehaviorSettings from "@/components/modals/PiBehaviorSettings.vue";
import PiProvidersSettings from "@/components/modals/PiProvidersSettings.vue";
import SettingsGroup from "@/components/modals/SettingsGroup.vue";
import SettingsOption from "@/components/modals/SettingsOption.vue";
import SettingsPageHeader from "@/components/modals/SettingsPageHeader.vue";
import PiExtensionSources from "@/components/modals/PiExtensionSources.vue";
import PiBuiltinExtensions from "@/components/modals/PiBuiltinExtensions.vue";

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
  { key: "behavior", label: "Behavior", icon: BrainIcon, enabled: true },
  { key: "commands", label: "Commands", icon: SlashCommands2Icon },
  { key: "mcp", label: "MCP", icon: McpIcon },
  { key: "extensions", label: "Extensions", icon: CodeBoxIcon, enabled: true },
  { key: "providers", label: "Providers", icon: CloudIcon, enabled: true },
  { key: "usage", label: "Usage", icon: BarChart2Icon },
  { key: "skills-installed", label: "Skills", icon: BookOpenIcon },
  { key: "skills-catalog", label: "Skills Catalog", icon: BookIcon },
  { key: "runtime", label: "Runtime", icon: TerminalIcon, enabled: true },
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
const { resources } = useConversationSession();
const { preference: themePreference, options: themeOptions, setTheme } = useTheme();
const serverSettings = useServerSettings();

const visibleNavItems = computed(() =>
  navItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.value.trim().toLowerCase()),
  ),
);

const selectItem = (key: string) => {
  activeKey.value = key;
};

// Load server-side runtime settings when the runtime panel opens.
// The dialog mounts the SettingsView as a singleton, so we trigger the
// fetch from the script setup block on first activation rather than
// per-mount: the first click that hits the Runtime tab will pay the
// network round-trip, every subsequent click reads from cache.
const ensureRuntimeLoaded = () => {
  if (activeKey.value === "runtime" && !serverSettings.loaded.value) {
    void serverSettings.load();
  }
};
watch(activeKey, ensureRuntimeLoaded, { immediate: true });

// Local mirror of the path so the input doesn't fight server-side
// normalisation. We commit on blur / enter via `commitRuntimeSettings`.
const runtimePathDraft = ref("");
watch(
  () => serverSettings.settings.value.externalPiPath,
  (next) => {
    runtimePathDraft.value = next;
  },
  { immediate: true },
);

// The server resolves the configured path against $PATH. When the
// user leaves the field blank we still surface what the server will
// actually spawn, so the hint reads "uses /Users/foo/.bun/bin/pi"
// rather than a bare "pi" that the browser can't render meaningfully.
const externalPi = computed(() => serverSettings.settings.value.externalPi);
const runtimePathPlaceholder = computed(() => {
  const resolved = externalPi.value.resolved;
  if (resolved) return resolved;
  return serverSettings.settings.value.useExternalPi ? "/usr/local/bin/pi" : "pi";
});

const runtimePathMissing = computed(() => {
  const ext = externalPi.value;
  return ext.configured && ext.resolved === null;
});

const commitRuntimeSettings = async (useExternalPi = serverSettings.settings.value.useExternalPi) => {
  const next = {
    useExternalPi,
    externalPiPath: runtimePathDraft.value.trim(),
  };
  // No-op when the local draft already matches the server view.
  if (
    next.useExternalPi === serverSettings.settings.value.useExternalPi &&
    next.externalPiPath === serverSettings.settings.value.externalPiPath
  ) {
    return;
  }
  try {
    await serverSettings.save(next);
  } catch {
    // Errors are surfaced via `serverSettings.error`; no need to
    // rethrow here because the UI shows the message inline.
  }
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
            <SettingsPageHeader title="Appearance" description="Choose how Pichamber looks on this device." />

            <SettingsGroup title="Theme">
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
            </SettingsGroup>
          </template>

          <template v-else-if="activeKey === 'sessions'">
            <SettingsPageHeader title="Sessions" description="Control which sessions appear in the sidebar." />

            <SettingsOption title="Hide temporary sessions" description="Hide sessions under /tmp and macOS temporary folders.">
              <input v-model="settings.hideTemporarySessions" type="checkbox" />
            </SettingsOption>
          </template>

          <template v-else-if="activeKey === 'extensions'">
            <SettingsPageHeader title="Extensions" description="Resources loaded by Pi for the active session." />

            <div v-if="resources.diagnostics.length" class="extension-diagnostics">
              <article v-for="diagnostic in resources.diagnostics" :key="`${diagnostic.path}:${diagnostic.error}`">
                <strong>{{ diagnostic.path }}</strong>
                <span>{{ diagnostic.error }}</span>
              </article>
            </div>

            <div v-if="!resources.extensionInventoryAvailable" class="extension-empty">
              This Pi runtime does not expose its extension inventory.
            </div>
            <div v-else-if="resources.extensions.length" class="extension-list">
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
            <PiBuiltinExtensions />
            <PiExtensionSources />
          </template>

          <PiProvidersSettings v-else-if="activeKey === 'providers'" />

          <PiBehaviorSettings v-else-if="activeKey === 'behavior'" />

          <template v-else-if="activeKey === 'runtime'">
            <SettingsPageHeader title="Runtime" description="Choose which Pi build serves new sessions." />

            <SettingsGroup title="Pi executable">
              <SettingsOption
                title="Use external Pi executable"
                description="Spawn pi --mode rpc for new sessions instead of the bundled SDK."
              >
                <input
                  :checked="serverSettings.settings.value.useExternalPi"
                  :disabled="serverSettings.saving.value || !serverSettings.loaded.value"
                  type="checkbox"
                  @change="(event) => {
                    const target = event.target as HTMLInputElement;
                    void commitRuntimeSettings(target.checked);
                  }"
                />
              </SettingsOption>

              <SettingsOption
                inline
                title="Path"
                description="Absolute path to pi, or a bare name resolved through $PATH."
              >
                <input
                  v-model="runtimePathDraft"
                  type="text"
                  spellcheck="false"
                  :placeholder="runtimePathPlaceholder"
                  :disabled="serverSettings.saving.value || !serverSettings.loaded.value || !serverSettings.settings.value.useExternalPi"
                  @blur="() => void commitRuntimeSettings()"
                  @keydown.enter="(event) => {
                    (event.target as HTMLInputElement).blur();
                  }"
                />
              </SettingsOption>

              <p
                v-if="serverSettings.error.value"
                class="settings-page__error"
                role="alert"
              >
                {{ serverSettings.error.value }}
              </p>
              <p v-else-if="runtimePathMissing" class="settings-page__error" role="alert">
                Couldn't find <code>{{ externalPi.rawPath || "pi" }}</code> on
                <code>$PATH</code>. Enter an absolute path or install
                <code>pi</code> and restart the server.
              </p>
              <p v-else-if="serverSettings.settings.value.useExternalPi" class="settings-page__hint">
                Sessions open a fresh
                <code>{{ externalPi.resolved }}</code>
                subprocess. Files, Git, and PTY still run as pichamber services.
              </p>
            </SettingsGroup>
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
  font-family: var(--ui-font-mono);
  font-size: 11px;
}
.extension-card p,
.extension-empty { margin: 0; color: var(--ui-text-muted); font-size: 12px; }
.extension-empty { max-width: 720px; padding: 20px 0; border-top: 1px solid var(--ui-border-subtle); }

.settings-option--inline :deep(input[type="text"]) {
  flex: 1 1 280px;
  max-width: 420px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: inherit;
  font: inherit;
  font-family: var(--ui-font-mono);
  font-size: 13px;
}
.settings-page__error {
  max-width: 720px;
  margin: 6px 0 0;
  padding: 10px 12px;
  border-left: 3px solid var(--ui-error-strong);
  border-radius: 4px;
  background: var(--ui-error-bg);
  color: var(--ui-error-fg);
  font-size: 12px;
}
.settings-page__hint {
  max-width: 720px;
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}
.settings-page__hint code,
.settings-option code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--ui-surface-selected);
  font-family: var(--ui-font-mono);
  font-size: 11px;
}
</style>
