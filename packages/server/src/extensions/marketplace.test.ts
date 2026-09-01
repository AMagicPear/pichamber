import { afterEach, describe, expect, it, mock } from "bun:test";
import { searchPiMarketplace } from "./marketplace";

const originalFetch = globalThis.fetch;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Bun's `fetch` type carries extra members (e.g. `preconnect`), so a bare mock
// must be cast to satisfy `typeof fetch`.
const mockFetch = (impl: (input: string | URL) => Promise<Response>) => mock(impl) as unknown as typeof fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("searchPiMarketplace", () => {
  it("proxies the pi.dev gallery HTML when it renders package cards", async () => {
    globalThis.fetch = mockFetch(async () =>
      new Response('<article data-package-card="true" data-package-name="abc"></article>', { status: 200 }),
    );
    const res = await searchPiMarketplace({ name: "", type: "extension", sort: "downloads", page: 2 });
    expect(res.source).toBe("pi.dev");
    if (res.source === "pi.dev") {
      expect(res.page).toBe(2);
      expect(res.html).toContain('data-package-card="true"');
    }
  });

  it("falls back to npm when pi.dev is unreachable, mapping package fields", async () => {
    globalThis.fetch = mockFetch(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("pi.dev")) return new Response("", { status: 500 });
      return json({
        total: 1,
        objects: [{ package: { name: "npm-foo", description: "desc", author: { name: "ann" }, date: "2023-01-01T00:00:00.000Z" } }],
      });
    });
    const res = await searchPiMarketplace({ name: "foo", type: "", sort: "downloads", page: 1 });
    expect(res.source).toBe("npm");
    if (res.source === "npm") {
      expect(res.total).toBe(1);
      expect(res.packages).toHaveLength(1);
      expect(res.packages[0]).toMatchObject({
        name: "npm-foo",
        description: "desc",
        author: "ann",
        date: "2023-01-01T00:00:00.000Z",
        source: "npm:npm-foo",
      });
    }
  });

  it("falls back to npm when the gallery returns no cards (malformed page)", async () => {
    globalThis.fetch = mockFetch(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("pi.dev")) return new Response("<html>shell only</html>", { status: 200 });
      return json({ total: 0, objects: [] });
    });
    const res = await searchPiMarketplace({ name: "", type: "", sort: "name", page: 1 });
    expect(res.source).toBe("npm");
  });

  it("sorts npm fallback by name within the page", async () => {
    globalThis.fetch = mockFetch(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("pi.dev")) return new Response("<html>shell only</html>", { status: 200 });
      return json({
        total: 2,
        objects: [
          { package: { name: "z-pkg", description: "z" } },
          { package: { name: "a-pkg", description: "a" } },
        ],
      });
    });
    const res = await searchPiMarketplace({ name: "", type: "", sort: "name", page: 1 });
    expect(res.source).toBe("npm");
    if (res.source === "npm") expect(res.packages.map((p) => p.name)).toEqual(["a-pkg", "z-pkg"]);
  });
});
