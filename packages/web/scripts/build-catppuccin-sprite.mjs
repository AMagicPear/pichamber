/**
 * Concatenates every catppuccin-mocha SVG into a single sprite file at
 * `src/assets/catppuccin-sprite.svg`. Consumers reference each icon via
 * `<svg><use href="...#catppuccin-{name}"/></svg>`, which the browser
 * resolves against this single file (one fetch, no per-icon request).
 *
 * Run automatically via the `predev` and `prebuild` hooks in
 * `packages/web/package.json`. Idempotent — safe to re-run; safe to commit
 * the generated file so fresh clones work without the script.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const iconDir = join(pkgRoot, "node_modules/catppuccin-vsc-icons/icons/mocha");
const outFile = join(pkgRoot, "src/assets/catppuccin-sprite.svg");

const files = readdirSync(iconDir).filter((f) => f.endsWith(".svg")).sort();
const symbols = files.map((file) => {
  const name = file.slice(0, -".svg".length);
  const raw = readFileSync(join(iconDir, file), "utf8");
  // Inner = everything between the opening <svg ...> and closing </svg>.
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const viewBox = raw.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 16 16";
  return `  <symbol id="catppuccin-${name}" viewBox="${viewBox}">${inner}</symbol>`;
});

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
${symbols.join("\n")}
</svg>
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, sprite);
console.log(`[catppuccin-sprite] ${files.length} icons → ${outFile}`);
