<script setup lang="ts">
import AddIcon from "@/assets/icons/Add.svg";
import AddCircleIcon from "@/assets/icons/AddCircle.svg";
import AiAgentIcon from "@/assets/icons/AiAgent.svg";
import BugIcon from "@/assets/icons/Bug.svg";
import CompassIcon from "@/assets/icons/Compass3.svg";
import FullscreenIcon from "@/assets/icons/Fullscreen.svg";
import HistoryIcon from "@/assets/icons/History.svg";
import MicIcon from "@/assets/icons/Mic.svg";
import ScalesIcon from "@/assets/icons/Scales3.svg";
import SearchEyeIcon from "@/assets/icons/SearchEye.svg";
import SendIcon from "@/assets/icons/SendPlane2.svg";
import ShieldUserIcon from "@/assets/icons/ShieldUser.svg";
import SurveyIcon from "@/assets/icons/Survey.svg";
import TargetIcon from "@/assets/icons/Target.svg";
import IconButton from "@/components/IconButton.vue";

const presets = [
  { label: "Explore the codebase", icon: CompassIcon },
  { label: "Catch me up", icon: HistoryIcon },
  { label: "Weigh my options", icon: ScalesIcon },
  { label: "Start feature planning", icon: SurveyIcon },
  { label: "Craft a Goal", icon: TargetIcon },
  { label: "Debug an issue", icon: BugIcon },
  { label: "Review my changes", icon: SearchEyeIcon },
];
</script>

<template>
  <main class="conversation">
    <h2>What are we working<br />on in amagicpear?</h2>

    <div class="composer">
      <p>@ for files/agents; / for commands and skills; ! for shell; # for snippets</p>
      <div class="composer__footer">
        <IconButton size="compact" label="Add attachment"><AddCircleIcon /></IconButton>
        <IconButton size="compact" label="Expand composer"><FullscreenIcon /></IconButton>
        <IconButton size="compact" label="Permissions"><ShieldUserIcon /></IconButton>
        <IconButton size="compact" label="Goal mode"><TargetIcon /></IconButton>
        <strong><span class="model-mark">Ƶ</span> Big Pickle</strong>
        <span class="model-mode"><AiAgentIcon class="model-icon" />Build</span>
        <IconButton size="compact" label="Dictation"><MicIcon /></IconButton>
        <IconButton size="compact" label="Send" disabled><SendIcon /></IconButton>
      </div>
    </div>

    <div class="presets" aria-label="Prompt starters">
      <button v-for="preset in presets" :key="preset.label" type="button">
        <component :is="preset.icon" />
        <span>{{ preset.label }}</span>
      </button>
      <IconButton class="presets__add" label="Add prompt starter"><AddIcon /></IconButton>
    </div>
  </main>
</template>

<style scoped>
.conversation {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  width: 100%;
  height: 100%;
  padding: 24px 24px 16px;
  overflow: auto;
  scrollbar-width: none;
}
.conversation::-webkit-scrollbar {
  display: none;
}
.conversation h2 {
  margin: 0;
  font-size: 28px;
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.02em;
  text-align: center;
}
.composer {
  width: min(100%, 464px);
  padding: 18px 12px 12px;
  border: 1px solid #dedbd2;
  border-radius: 13px;
  margin: 0;
}
.composer p {
  margin: 0 0 28px;
  color: #747474;
  font-size: 14px;
  line-height: 20px;
}
.composer__footer {
  display: flex;
  align-items: center;
  gap: 3px;
}
.composer__footer strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.model-mark {
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}
.model-icon {
  width: 16px;
  height: 16px;
  color: #718d28;
}
.model-mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #718d28;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.presets {
  display: flex;
  width: min(100%, 500px);
  justify-content: center;
  gap: 7px;
  flex-wrap: wrap;
  margin: 0;
}
.presets > button:not(.presets__add) {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid #d9d7cf;
  border-radius: 999px;
  color: #666;
  font-size: 14px;
  line-height: 18px;
}
.presets > button:not(.presets__add) svg {
  width: 14px;
  height: 14px;
  opacity: 0.7;
}
.presets > button:hover {
  background: rgb(0 0 0 / 4%);
}
.presets > :deep(.presets__add) {
  border: 1px solid #d9d7cf;
  border-radius: 999px;
  color: #666;
}
</style>
