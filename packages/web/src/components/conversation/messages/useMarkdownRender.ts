import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { activeTheme } from "@/stores/theme";

const codeBlockOptions = {
  fontFamily: "var(--ui-font-mono)",
  fontSize: 12,
  lineHeight: 18,
  maxHeight: 576,
};

export const useMarkdownRender = (final?: MaybeRefOrGetter<boolean | undefined>) => {
  const isFinal = computed(() => toValue(final) ?? true);
  const streaming = computed(() => !isFinal.value);

  return computed(() => ({
    mode: "chat" as const,
    customId: "chat",
    final: isFinal.value,
    htmlPolicy: "escape" as const,
    fade: !streaming.value,
    smoothStreaming: streaming.value ? ("auto" as const) : false,
    isDark: activeTheme.value === "dark",
    codeBlockOptions,
    batchRendering: streaming.value,
    maxLiveNodes: streaming.value ? 0 : undefined,
    renderBatchSize: streaming.value ? 16 : undefined,
    renderBatchDelay: streaming.value ? 8 : undefined,
    renderBatchBudgetMs: streaming.value ? 4 : undefined,
  }));
};
