<script setup lang="ts">
import { computed } from "vue";

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
 * those as routes — render them inert instead. Previewing lands together
 * with the file browser feature; the original path is kept in the href so
 * it stays visible on hover and copyable.
 */
const isLocal = computed(() => !/^[a-z][a-z0-9+.-]*:/i.test(props.node.href));
</script>

<template>
  <a
    :href="node.href"
    :title="isLocal ? `本地文件：${node.href}（预览即将推出）` : undefined"
    :target="isLocal ? undefined : '_blank'"
    :rel="isLocal ? undefined : 'noopener'"
    @click="isLocal && $event.preventDefault()"
  >
    {{ node.text }}
  </a>
</template>
