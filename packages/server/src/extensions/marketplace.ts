import type { PiMarketplacePackage, PiMarketplaceResponse } from "@amagicpear/pichamber-shared";

// ─── App-market catalog ────────────────────────────────────────────────
//
// pi.dev exposes no CORS, so the browser cannot fetch its gallery directly.
// This module is a thin HTTP proxy: it fetches the gallery HTML (or the npm
// registry fallback) and hands the payload back to the client. The client is
// responsible for interpreting the gallery HTML with DOMParser (Bun has no
// DOMParser, so the fragile markup parsing lives on the frontend, where it
// belongs).

const GALLERY_URL = "https://pi.dev/packages";
const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const PAGE_SIZE = 50;
const FETCH_TIMEOUT_MS = 8_000;

export type MarketplaceQuery = {
  name: string;
  type: string;
  sort: string;
  page: number;
};

const fetchText = async (url: URL): Promise<string> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.text();
};

// pi.dev gallery → raw HTML (client parses it).
const fetchGalleryHtml = async (query: MarketplaceQuery): Promise<string> => {
  const url = new URL(GALLERY_URL);
  url.searchParams.set("name", query.name);
  url.searchParams.set("type", query.type);
  url.searchParams.set("sort", query.sort);
  url.searchParams.set("page", String(query.page));
  const html = await fetchText(url);
  // The gallery renders nothing but a shell if it can't build its catalog;
  // treat a page with no package cards as an error so we fall back to npm.
  if (!html.includes('data-package-card="true"')) throw new Error("Gallery did not render any packages");
  return html;
};

const extractAuthor = (author: unknown, publisher: unknown): string => {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && typeof (author as { name?: unknown }).name === "string") {
    return (author as { name: string }).name;
  }
  const pub = publisher as { username?: unknown; name?: unknown } | undefined;
  if (pub && typeof pub === "object") {
    if (typeof pub.username === "string") return pub.username;
    if (typeof pub.name === "string") return pub.name;
  }
  return "";
};

// npm registry fallback → structured packages (no DOM parsing needed).
const fetchNpmFallback = async (query: MarketplaceQuery): Promise<PiMarketplaceResponse> => {
  const url = new URL(NPM_SEARCH_URL);
  url.searchParams.set(
    "text",
    query.name ? `keywords:pi-package ${query.name}` : "keywords:pi-package",
  );
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("from", String((query.page - 1) * PAGE_SIZE));
  url.searchParams.set("sort", query.sort === "downloads" ? "popularity" : "quality");

  const data = (await (await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).json()) as {
    total?: number;
    objects?: Array<{ package?: Record<string, unknown> }>;
  };

  const packages: PiMarketplacePackage[] = (data.objects ?? [])
    .map(({ package: p = {} }) => {
      const name = typeof p.name === "string" ? p.name : "";
      return {
        name,
        description: typeof p.description === "string" ? p.description : "",
        author: extractAuthor(p.author, p.publisher),
        types: [],
        date: typeof p.date === "string" ? p.date : undefined,
        source: `npm:${name}`,
      };
    })
    .filter((pkg) => pkg.name);

  // Best-effort ordering within the page for the sorts npm can't express.
  if (query.sort === "name") packages.sort((a, b) => a.name.localeCompare(b.name));
  else if (query.sort === "recent") packages.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return { source: "npm", packages, total: data.total ?? 0, page: query.page };
};

export const searchPiMarketplace = async (query: MarketplaceQuery): Promise<PiMarketplaceResponse> => {
  try {
    return { source: "pi.dev", html: await fetchGalleryHtml(query), page: query.page };
  } catch (galleryError) {
    // pi.dev unreachable / malformed — fall back to the npm registry search.
    console.warn(`[marketplace] pi.dev unavailable, falling back to npm: ${(galleryError as Error).message}`);
    return fetchNpmFallback(query);
  }
};
