<script setup lang="ts">
import { computed } from "vue";
import type { ModelDescriptor } from "@amagicpear/pichamber-shared";
import SelectorPopover from "@/components/ui/SelectorPopover.vue";
import ProviderLogo from "./ProviderLogo";
import MenuPanel from "@/components/ui/MenuPanel.vue";

const props = defineProps<{
  model: ModelDescriptor | undefined;
  availableModels: ModelDescriptor[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [model: ModelDescriptor];
}>();

/** Group available models by provider, keeping the current selection
 *  pinned at the top of its bucket so it stays visible.
 *  Each entry carries the provider's Pi display name for the group title. */
const groups = computed(() => {
  const buckets = new Map<string, { name: string; models: ModelDescriptor[] }>();
  for (const candidate of props.availableModels) {
    const bucket = buckets.get(candidate.provider) ?? { name: candidate.providerName, models: [] };
    bucket.models.push(candidate);
    buckets.set(candidate.provider, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([provider, group]) => ({
    id: provider,
    label: group.name,
    items: group.models.map((candidate) => ({
      id: `${candidate.provider}/${candidate.id}`,
      label: candidate.name,
      value: candidate,
      active: props.model?.provider === candidate.provider && props.model?.id === candidate.id,
      searchText: `${candidate.id} ${candidate.provider} ${candidate.providerName}`,
    })),
  }));
});

const onSelect = (item: { value: ModelDescriptor }, closePopover: () => void) => {
  emit("select", item.value);
  closePopover();
};

const placeholder = computed(() => {
  if (props.availableModels.length === 0) return "No models available";
  return props.model?.name ?? "Choose model";
});
</script>

<template>
  <SelectorPopover
    class="model-selector"
    :width="360"
    :panel-width="360"
    :panel-max-height="360"
    :disabled="disabled || availableModels.length === 0"
  >
    <template #trigger-icon>
      <ProviderLogo :provider-id="model?.provider" :model-id="model?.id" :size="16" />
    </template>
    <template #trigger-label>{{ placeholder }}</template>
    <template #default="{ close: closePopover, open }">
      <MenuPanel
        :groups="groups"
        :open="open"
        filterable
        filter-placeholder="Filter models…"
        item-role="option"
        @select="onSelect($event, closePopover)"
      >
        <template #item-icon="{ item }">
          <ProviderLogo :provider-id="item.value.provider" :model-id="item.value.id" :size="16" />
        </template>
      </MenuPanel>
    </template>
  </SelectorPopover>
</template>

<style scoped>
</style>
