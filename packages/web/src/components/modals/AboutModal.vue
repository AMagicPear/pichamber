<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppLogo from "@/components/AppLogo";
import Modal from "@/components/layout/Modal.vue";
import IconButton from "@/components/IconButton.vue";
import CloseIcon from "@/assets/icons/Close.svg";
import GithubIcon from "@/assets/icons/Github.svg";
import { getVersion } from "@/api/client";
import { version as APP_VERSION } from "../../../package.json";

defineProps<{ show: boolean }>();
const emit = defineEmits<{ close: [] }>();

// pi runs on the server, so its version comes from /api/version; the app's
// own version is this package's.
const piVersion = ref<string | null>(null);
onMounted(async () => {
  piVersion.value = (await getVersion().catch(() => null))?.pi ?? null;
});
</script>

<template>
  <Modal size="sm" :show="show" @close="emit('close')">
    <template #body>
      <div class="about">
        <AppLogo :width="64" :height="64" />
        <div class="about__titles">
          <h2>pichamber</h2>
          <div class="about__meta">
            <p>pichamber version {{ APP_VERSION }}</p>
            <p v-if="piVersion">pi version {{ piVersion }}</p>
          </div>
        </div>
        <div class="about__links">
          <a
            href="https://github.com/AMagicPear/pichamber"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GithubIcon />
            <span>GitHub</span>
          </a>
        </div>
        <p class="about__made-with">Made with love for the community</p>
        <IconButton class="about__close" label="Close" size="compact" @click="emit('close')">
          <CloseIcon />
        </IconButton>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.about {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}
.about__titles {
  display: grid;
  gap: 4px;
}
.about h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.about__meta {
  display: grid;
  gap: 2px;
  color: var(--ui-text-muted);
  font-size: 12px;
}
.about__meta p {
  margin: 0;
}
.about__links {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 8px;
}
.about__links a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-decoration: none;
  transition: color var(--ui-duration-fast) var(--ui-ease-standard);
}
.about__links a:hover {
  color: var(--ui-text);
}
.about__links svg {
  width: 16px;
  height: 16px;
}
.about__made-with {
  margin: 0;
  padding-top: 8px;
  color: rgb(136 136 136 / 60%);
  font-size: 12px;
}
.about__close {
  position: absolute;
  top: -8px;
  right: -8px;
  color: var(--ui-text-muted);
}
</style>
