/**
 * Reactive state persisted to localStorage.
 *
 * Shared by the settings and UI stores, which previously duplicated the
 * same load / save / watch / error-handling dance.
 */
import { reactive, watch } from "vue";

export const persistedState = <T extends object>(
  key: string,
  defaults: T,
  hydrate?: (raw: Partial<T>) => T,
): T => {
  let initial = { ...defaults };
  if (typeof window !== "undefined") {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Partial<T> | null;
      if (parsed && typeof parsed === "object") {
        initial = hydrate ? hydrate(parsed) : { ...defaults, ...parsed };
      }
    } catch {
      /* corrupted storage → defaults */
    }
  }

  const state = reactive(initial) as T;
  watch(
    state,
    (value) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota / privacy-mode errors */
      }
    },
    { deep: true },
  );
  return state;
};
