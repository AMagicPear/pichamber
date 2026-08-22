<script setup lang="ts">
import GitBranchIcon from "lucide-static/icons/git-branch.svg";
import FileTextIcon from "lucide-static/icons/file-text.svg";
import IconButton from "@/components/ui/IconButton.vue";

const props = defineProps<{
  /** Whether the whole group is displayed (drives the `<Transition>` v-show). */
  open?: boolean;
  /** Which action buttons are included when the group is shown. */
  show?: { fork?: boolean; copy?: boolean };
}>();

const emit = defineEmits(['fork', 'copy']);
</script>

<template>
  <Transition name="message-actions">
    <span v-show="open" class="message-actions">
      <IconButton v-if="show?.fork" size="mini" label="Fork here" @click="emit('fork')">
        <GitBranchIcon />
      </IconButton>
      <IconButton v-if="show?.copy" size="mini" label="Copy text" @click="emit('copy')">
        <FileTextIcon />
      </IconButton>
    </span>
  </Transition>
</template>

<style scoped>
.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
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
