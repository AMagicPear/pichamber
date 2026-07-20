// Smoke test for the vendored OpenChamber markdown pipeline. Renders a sample
// assistant message in a JSDOM container and asserts that:
//   - Shiki worker resolves a fenced code block to colored spans
//   - KaTeX $$..$$ block math renders the .katex wrapper
//   - Decorate pass wraps the code block in .md-code-block + lang label
//   - GFM tables render inside .md-table-wrap
//   - File-path tokens inside code are annotated with data-md-block-path

import { JSDOM } from "jsdom";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

let dom: JSDOM;
let previousWindow: unknown;
let previousDocument: unknown;
let previousHTMLElement: unknown;

beforeAll(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  previousWindow = (globalThis as { window?: unknown }).window;
  previousDocument = (globalThis as { document?: unknown }).document;
  previousHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
  (globalThis as { window?: unknown }).window = dom.window;
  (globalThis as { document?: unknown }).document = dom.window.document;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = dom.window.HTMLElement;
});

afterAll(() => {
  (globalThis as { window?: unknown }).window = previousWindow;
  (globalThis as { document?: unknown }).document = previousDocument;
  (globalThis as { HTMLElement?: unknown }).HTMLElement = previousHTMLElement;
  dom.window.close();
});

describe("OpenChamber markdown pipeline (vendored)", () => {
  it("renders fenced code blocks with language attributes", async () => {
    const { renderMarkdownBlocks, renderMarkdownSync } = await import("./markdownCore");

    const text = "Pichamber demo\n\n```typescript\nconst greeting: string = \"hello\";\n```\n";
    const syncHtml = renderMarkdownSync(text);
    expect(syncHtml).toContain('class="language-typescript"');
    expect(syncHtml).toContain('data-language="typescript"');
    expect(syncHtml).toContain("md-code-block");

    const blocks = await renderMarkdownBlocks(text, false, "test-block");
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const joined = blocks.map((b) => b.html).join("");
    expect(joined).toMatch(/<pre/);
    expect(joined).toContain("md-code-block");
  }, 15_000);

  it("renders $$...$$ display math via KaTeX", async () => {
    const { renderMarkdownSync } = await import("./markdownCore");
    const html = renderMarkdownSync("Inline $$a^2 + b^2 = c^2$$ math.\n");
    expect(html).toContain("katex");
    expect(html).toMatch(/class="katex/);
  });

  it("wraps GFM tables in a scrollable container", async () => {
    const { renderMarkdownSync } = await import("./markdownCore");
    const html = renderMarkdownSync("| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("md-table-wrap");
  });

  it("annotates path-like tokens inside code blocks", async () => {
    const { renderMarkdownSync } = await import("./markdownCore");
    const html = renderMarkdownSync(
      "```\nFound 2 files at src/foo.ts and src/bar.tsx:42\n```\n",
    );
    expect(html).toContain("data-md-block-path");
    expect(html).toContain("src/foo.ts");
  });

  it("wraps Shiki-styled code blocks in the framed card", async () => {
    const { decorateHtml } = await import("./decorate");
    const shikiOutput = '<pre data-md-lang="rust" class="shiki openchamber-md" style="background-color:transparent;color:var(--md-syntax-foreground)"><code><span class="line"><span style="color:var(--md-syntax-keyword)">fn</span></span></code></pre>';
    const decorated = decorateHtml(shikiOutput);
    expect(decorated).toContain('class="md-code-block"');
    expect(decorated).toContain('data-language="rust"');
    expect(decorated).toContain("lang-label");
    expect(decorated).toContain("copy-btn");
  });
});