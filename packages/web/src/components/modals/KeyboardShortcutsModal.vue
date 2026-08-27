<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CloseIcon from "lucide-static/icons/x.svg";
import Modal from "@/components/ui/Modal.vue";
import IconButton from "@/components/ui/IconButton.vue";
import { settings } from "@/stores/settings";

defineProps<{ show: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const sendKeys = computed(() => settings.sendKey === "enter" ? ["Enter"] : ["Cmd", "/", "Ctrl", "+", "Enter"]);
const followUpKeys = computed(() => ["Alt", "+", ...sendKeys.value]);

const groups = computed(() => [
  {
    title: t("sidebar.shortcuts.composer"),
    items: [
      { label: t("sidebar.shortcuts.send"), keys: sendKeys.value },
      { label: t("sidebar.shortcuts.newline"), keys: ["Shift", "+", "Enter"] },
      { label: t("sidebar.shortcuts.followUp"), keys: followUpKeys.value },
      { label: t("sidebar.shortcuts.dismissOrAbort"), keys: ["Esc"] },
    ],
  },
  {
    title: t("sidebar.shortcuts.autocomplete"),
    items: [
      { label: t("sidebar.shortcuts.openCommands"), keys: ["/"] },
      { label: t("sidebar.shortcuts.openFiles"), keys: ["@"] },
      { label: t("sidebar.shortcuts.navigateSuggestions"), keys: ["Up", "/", "Down"] },
      { label: t("sidebar.shortcuts.acceptSuggestion"), keys: sendKeys.value },
    ],
  },
]);
</script>

<template>
  <Modal size="sm" :show="show" @close="emit('close')">
    <template #body>
      <div class="shortcuts">
        <div class="shortcuts__heading">
          <h2>{{ t('sidebar.keyboardShortcuts') }}</h2>
          <IconButton :label="t('common.close')" size="compact" @click="emit('close')">
            <CloseIcon />
          </IconButton>
        </div>
        <section v-for="group in groups" :key="group.title" class="shortcuts__group">
          <h3>{{ group.title }}</h3>
          <div v-for="item in group.items" :key="item.label" class="shortcuts__item">
            <span>{{ item.label }}</span>
            <span class="shortcuts__keys">
              <template v-for="(key, index) in item.keys" :key="`${key}-${index}`">
                <kbd v-if="item.keys.length === 1 || (key !== '/' && key !== '+')">{{ key }}</kbd>
                <span v-else class="shortcuts__separator">{{ key }}</span>
              </template>
            </span>
          </div>
        </section>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.shortcuts {
  display: grid;
  width: 100%;
  gap: 18px;
}

.shortcuts__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.shortcuts h2,
.shortcuts h3 {
  margin: 0;
}

.shortcuts h2 {
  color: var(--ui-text-strong);
  font-size: 16px;
  font-weight: 600;
}

.shortcuts__group {
  display: grid;
  gap: 4px;
}

.shortcuts h3 {
  padding: 0 2px 3px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.shortcuts__item {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 2px;
  color: var(--ui-text);
  font-size: 13px;
}

.shortcuts__keys {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  color: var(--ui-text-muted);
}

.shortcuts kbd {
  min-width: 20px;
  padding: 2px 5px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 4px;
  background: var(--ui-surface);
  color: var(--ui-text-strong);
  font-family: inherit;
  font-size: 11px;
  line-height: 14px;
  text-align: center;
}

.shortcuts__separator {
  font-size: 11px;
}
</style>
