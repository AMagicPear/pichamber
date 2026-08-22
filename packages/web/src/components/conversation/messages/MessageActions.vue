<script setup lang="ts">
import GitForkIcon from "lucide-static/icons/git-fork.svg";
import IconButton from "@/components/ui/IconButton.vue";
import { lucideIcon } from "@/components/ui/morphIcons";
import { MorphIcon } from "morphicons/vue";
import { reactive } from "vue";

const props = defineProps<{
  /** Whether the whole group is displayed (drives the `<Transition>` v-show). */
  open?: boolean;
  /** Which action buttons are included when the group is shown. */
  show?: { fork?: boolean; copy?: boolean };
}>();

const emit = defineEmits(['fork', 'copy']);
const checked = reactive({ copy: false });

const dynamicClick = (event: MouseEvent, action: 'copy') => {
  emit(action, event);
  checked[action] = true;
  setTimeout(() => {
    checked[action] = false;
  }, 1600);
};
</script>

<template>
  <Transition name="message-actions">
    <span v-show="open" class="message-actions">
      <IconButton v-if="show?.fork" size="mini" label="Fork here" @click="emit('fork')">
        <GitForkIcon />
      </IconButton>
      <IconButton v-if="show?.copy" size="mini" label="Copy text" @click="dynamicClick($event, 'copy')">
        <MorphIcon :icon="lucideIcon(checked.copy ? 'check' : 'copy')" spring="snappy" />
      </IconButton>
    </span>
  </Transition>
</template>

<style scoped>
.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.message-actions-enter-active,
.message-actions-leave-active {
  transition: opacity var(--ui-duration-fast) var(--ui-ease-standard);
}

.message-actions-enter-from,
.message-actions-leave-to {
  opacity: 0;
}
</style>
