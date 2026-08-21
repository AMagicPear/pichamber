<script setup lang="ts">
import { computed } from "vue";
import { openFile, toMessage } from "@/api/client";
import { workspace } from "@/stores/workspace";
import { pushErrorToast } from "@/stores/extensionUi";

/** Structural peek at the link node so we don't type-import markstream's
 *  LinkNodeProps into defineProps (the SFC compiler can't resolve it). */
type LinkNode = {
  href: string;
  text: string;
  title: string | null;
};

const props = defineProps<{ node: LinkNode }>();

/**
 * A link is a local filesystem reference when it carries no URL scheme
 * (absolute paths, `~/…`, relative paths). The SPA router would swallow
 * those as routes — render them inert instead. Clicking one opens the
 * path with the OS default app via the server (same workspace containment
 * rules as the files panel); the original path stays in the href so it
 * remains visible on hover and copyable.
 */
const isLocal = computed(() => !/^[a-z][a-z0-9+.-]*:/i.test(props.node.href));

const onClick = async (event: MouseEvent) => {
  if (!isLocal.value) return;
  event.preventDefault();
  try {
    await openFile(workspace.sessionId, props.node.href);
  } catch (err) {
    pushErrorToast(toMessage(err));
  }
};
</script>

<template>
  <a
    :href="node.href"
    :title="isLocal ? `打开本地文件：${node.href}` : undefined"
    :target="isLocal ? undefined : '_blank'"
    :rel="isLocal ? undefined : 'noopener'"
    @click="onClick"
  >
    {{ node.text }}
  </a>
</template>
