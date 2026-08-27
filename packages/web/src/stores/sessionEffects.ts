import { watch } from "vue";
import { settings } from "@/stores/settings";
import { pushErrorToast } from "@/stores/extensionUi";
import { refreshSessions, workspace } from "@/stores/workspace";
import { model, windowTitle } from "@/stores/session";

/** Effects are the narrow boundary between session protocol reduction and the
 * browser. Reducers return these descriptions; only this module touches DOM,
 * notifications, or audio. */
export type SessionEffect =
  | { type: "session-settled" }
  | { type: "error"; message: string };

const playCompletionChime = () => {
  if (typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const schedule = (at: number, frequency: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(at);
      oscillator.stop(at + duration);
    };
    const now = ctx.currentTime + 0.005;
    schedule(now, 880, 0.18);
    schedule(now + 0.09, 1320, 0.16);
    if (ctx.state === "suspended") void ctx.resume();
    setTimeout(() => void ctx.close(), 400);
  } catch {
    // Browser audio can be unavailable before a user gesture.
  }
};

const notifySessionSettled = () => {
  if (settings.notifySound) playCompletionChime();
  if (!settings.notifyDesktop || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const label = model.value?.name?.trim() || model.value?.id || model.value?.provider || "";
    const notification = new Notification("Pi Chamber", {
      body: label ? `${label} finished responding.` : "Agent finished responding.",
      silent: true,
      tag: "pichamber-completion",
    });
    notification.onclick = () => { window.focus(); notification.close(); };
    setTimeout(() => notification.close(), 7_000);
  } catch {
    // Permission may change between the check and construction.
  }
};

export const applySessionEffects = (effects: SessionEffect[]) => {
  for (const effect of effects) {
    if (effect.type === "error") pushErrorToast(effect.message);
    else {
      notifySessionSettled();
      void refreshSessions();
    }
  }
};

/** Application wiring belongs outside the reducer so importing session state
 * in tests or utilities never mutates the document. */
export const initializeSessionEffects = () => {
  watch(
    [() => workspace.sessionName, windowTitle],
    ([sessionName, title]) => {
      document.title = `${[sessionName, title].filter(Boolean).join(" · ")} - Pi Chamber`;
    },
    { immediate: true },
  );
};
