import type { PiMarketplacePackage, PiMarketplaceResponse, PiMarketplaceResult } from "@amagicpear/pichamber-shared";

// ─── App-market interpretation ─────────────────────────────────────────
//
// pi.dev exposes no CORS (and Bun has no DOMParser), so the server proxies
// the gallery's raw HTML and the client does the fragile markup parsing here
// with the native DOMParser. The npm fallback arrives pre-structured from the
// server, so `normalizePiMarketplace` just returns it as-is.

const toPackage = (card: Element): PiMarketplacePackage => {
  const name = card.getAttribute("data-package-name") ?? "";
  const types = (card.getAttribute("data-package-types") ?? "").split(/\s+/).filter(Boolean);
  const downloads = Number(card.getAttribute("data-package-downloads"));
  const dateMs = Number(card.getAttribute("data-package-date"));
  return {
    name,
    description: card.querySelector(".packages-desc")?.textContent?.trim() ?? "",
    author: card.querySelector(".packages-meta span")?.textContent?.trim() ?? "",
    types,
    downloads: Number.isFinite(downloads) && downloads > 0 ? downloads : undefined,
    date: Number.isFinite(dateMs) && dateMs > 0 ? new Date(dateMs).toISOString() : undefined,
    source: `npm:${name}`,
  };
};

const parseGalleryHtml = (html: string): PiMarketplacePackage[] => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll('[data-package-card="true"]')].map(toPackage);
};

const parseGalleryTotal = (html: string): number => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const label = doc.querySelector(".packages-count")?.textContent ?? "";
  const n = Number(label.split("/").at(-1)?.replace(/[^\d]/g, "") ?? "");
  return Number.isFinite(n) ? n : 0;
};

export const normalizePiMarketplace = (response: PiMarketplaceResponse): PiMarketplaceResult => {
  if (response.source === "pi.dev") {
    return {
      packages: parseGalleryHtml(response.html),
      total: parseGalleryTotal(response.html),
      page: response.page,
      source: "pi.dev",
    };
  }
  return response;
};

const compact = (n: number, digits: number, suffix: string) =>
  `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(digits)}${suffix}`;

export const formatDownloads = (n: number): string => {
  if (n >= 1_000_000) return `${compact(n / 1_000_000, 1, "M")}/mo`;
  if (n >= 1_000) return `${compact(n / 1_000, 1, "K")}/mo`;
  return `${n}/mo`;
};

export const formatRelativeDate = (iso: string, locale?: string): string => {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = time - Date.now();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1_000],
  ];
  const abs = Math.abs(diff);
  const [unit, unitMs] = units.find(([, ms]) => abs >= ms) ?? ["second", 1_000];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(diff / unitMs), unit);
};
