# Third-Party Licenses

pichamber is built on top of a number of open-source projects. This file
lists the ones that ship code or assets inside the distributed package
(`dist/server.js`, `dist-web/`, the catppuccin sprite).

Full license texts for every transitive dependency are present in
`node_modules/<package>/LICENSE` after `bun install`. The summaries below
are for at-a-glance attribution; the upstream text is the authoritative
source.

## Direct dependencies (workspace + runtime)

### MIT

- **@earendil-works/pi-coding-agent** — <https://github.com/earendil-works/pi>
  The Pi coding-agent runtime; provides the LLM session, tool dispatcher, and
  extension UI protocol used by the server. Copyright (c) 2025 earendil-works.

- **@earendil-works/pi-agent-core** — <https://github.com/earendil-works/pi>
  Core agent types and utilities (re-exported by pi-coding-agent).

- **@earendil-works/pi-ai** — <https://github.com/earendil-works/pi>
  Model adapters used to talk to provider APIs.

- **pi-apply-patch** — <https://github.com/code-yeongyu/pi-apply-patch>
  Codex-style `apply_patch` extension bundled as a pichamber built-in. The
  bundled source includes code ported from senpi-mono; see the extension's
  `LICENSE` and `NOTICE` files for the applicable attribution.

- **bun-pty** — <https://github.com/leeoniya/bun-pty>
  Node-pty-compatible PTY bindings for Bun, used by the in-app terminal panel.

- **ghostty-web** — <https://github.com/coder/ghostty-web>
  WebAssembly build of Ghostty, powers the in-app terminal.

- **markstream-vue** — <https://github.com/Simon-He95/markstream-vue>
  Streaming markdown renderer used for chat messages and tool output.

- **mermaid** — <https://github.com/mermaid-js/mermaid>
  Diagram-as-code renderer (flowchart / sequence / class etc.) embedded
  in markdown blocks.

- **katex** — <https://github.com/KaTeX/KaTeX>
  Math typesetting for the markdown renderer.

- **stream-diffs** — <https://github.com/pichamber/stream-diffs>
  Diff / file view surface (pierre + monaco) used by the read/edit/write
  tool results.

- **vue / vue-router** — <https://github.com/vuejs/core>
  The framework and router for the SPA.

- **catppuccin-vsc-icons** — <https://github.com/catppuccin/vscode-icons>
  Source for the per-file/per-folder icons. The full icon set is bundled
  as a single `<symbol>` sprite by `scripts/build-catppuccin-sprite.mjs`
  during `predev` / `prebuild`. The generated sprite carries the upstream
  MIT copyright header at the top, satisfying the license's notice
  requirement for the embedded copy. Copyright (c) 2023 Catppuccin,
  Copyright (c) 2023 thang-nm.

## Notable transitive dependencies (bundled into the web build)

These ship inside `dist-web/assets/*.js` because Vite inlines them.

### MIT

- **shiki** — syntax highlighter used by markstream-vue
  (<https://github.com/shikijs/shiki>)
- **monaco-editor** — code editor used by stream-diffs
  (<https://github.com/microsoft/monaco-editor>)
- **cytoscape / cytoscape-cose-bilkent / cytoscape-fcose** — graph layout
  engines used by mermaid
  (<https://github.com/cytoscape/cytoscape.js>)

### ISC

- **d3 / d3-* modules** — used by mermaid
  (<https://github.com/d3/d3>). Copyright (c) 2010-2023 Mike Bostock.

### BSD-3-Clause

- **d3-sankey** — used by mermaid
  (<https://github.com/d3/d3-sankey>). Copyright (c) 2012, Michael Bostock.

### Apache-2.0

- **hls.js** — HTTP Live Streaming playback used by markstream-vue for
  video embeds (<https://github.com/video-dev/hls.js>).
  Per the Apache-2.0 terms, the upstream NOTICE file is shipped alongside
  the LICENSE in `node_modules/hls.js/NOTICE`. The full text is at
  <https://www.apache.org/licenses/LICENSE-2.0>.

## Other dependencies (build-time only, not shipped)

These are `devDependencies` and are not present in the distributed
package. Listed for completeness; their LICENSE files still ship with
`bun install` per the same MIT/Apache/etc. terms.

`vite`, `vite-svg-loader`, `vite-plugin-vue-devtools`, `@vitejs/plugin-vue`,
`@vitejs/plugin-vue-jsx`, `@vue/tsconfig`, `vue-tsc`, `typescript`,
`concurrently`, `oxlint`, `jiti`, `npm-run-all2`, `@types/bun`,
`@types/node`, `@types/babel__core`, `@tsconfig/node24`.

## Update procedure

When adding a new runtime dependency:

1. Confirm the upstream license (must be a permissive license compatible
   with our MIT distribution — MIT, ISC, BSD-2/3-Clause, Apache-2.0, or
   public-domain equivalents). Copyleft licenses (GPL/AGPL/SSPL/EUPL)
   require a separate review.
2. Add the package to the appropriate section above with a one-line
   purpose note.
3. For anything that ends up embedded in a generated artifact
   (sprites, bundled config, font files, etc.) add a copyright header
   to the generated file so the embedded copy is self-attributing —
   see `scripts/build-catppuccin-sprite.mjs` for the reference pattern.
4. Run `bun install` to confirm the upstream LICENSE ends up in
   `node_modules/<package>/LICENSE`.
