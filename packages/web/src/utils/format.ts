/**
 * Locale-aware display formatting.
 *
 * The server sends raw facts (counts, ratios, epoch ms); the client renders
 * them in the active UI language. Keeping every `Intl` call here means the
 * Context pane and any future stats surface format identically, and a
 * language switch re-renders them without a server round-trip.
 */
import type { LastAssistantUsage } from "@amagicpear/pichamber-shared";

/** Ratio (0..1) → "99.4%". Em dash when the ratio is unknown. */
export const formatPercent = (ratio: number | null | undefined): string =>
  ratio == null ? "—" : `${(ratio * 100).toFixed(1)}%`;

/** Grouped integer in the active locale, e.g. "95,881". Em dash when unknown. */
export const formatCount = (value: number | null | undefined, locale: string): string =>
  value == null ? "—" : new Intl.NumberFormat(locale).format(value);

/** Localized date-time, e.g. "Jul 20, 2026, 9:10 AM" / "2026年7月20日 09:10". */
export const formatDateTime = (timestamp: number | null | undefined, locale: string): string =>
  timestamp == null
    ? ""
    : new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(timestamp);

/** Group every bucket of a usage breakdown in the active locale. */
export const formatUsage = (
  usage: LastAssistantUsage,
  locale: string,
): { [K in keyof LastAssistantUsage]: string } => ({
  input: formatCount(usage.input, locale),
  output: formatCount(usage.output, locale),
  reasoning: formatCount(usage.reasoning, locale),
  cacheRead: formatCount(usage.cacheRead, locale),
  cacheWrite: formatCount(usage.cacheWrite, locale),
});
