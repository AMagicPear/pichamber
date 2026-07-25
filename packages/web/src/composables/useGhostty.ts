/**
 * Lazily load the ghostty-web WASM module exactly once per app lifetime.
 *
 * We bypass ghostty-web's default `init()` because it computes the WASM URL
 * via `new URL('../ghostty-vt.wasm', import.meta.url)`. After Vite bundles
 * the library into `.vite/deps/`, that relative URL no longer matches the
 * served location, and `init()` falls back to fetching `/ghostty-vt.wasm`
 * which only works if the file is manually copied to `public/`.
 *
 * Instead we let Vite resolve `ghostty-web/ghostty-vt.wasm?url` — the
 * package's `exports` field exposes that subpath, so Vite serves the file
 * from a stable URL in dev and emits a hashed asset in production. We then
 * call `Ghostty.load(url)` directly and hand the resulting Ghostty instance
 * to every Terminal via `new Terminal({ ghostty })`.
 *
 * Reference: https://github.com/coder/ghostty-web/issues (Vite integration
 * patterns); production users include misterclayt0n/the-editor and
 * LowRezStudio/Tempest.
 */

import { Ghostty } from "ghostty-web";
// Vite resolves the `?url` query to a public URL for the asset.
// The `ghostty-web` package exposes `./ghostty-vt.wasm` in its `exports`
// field, which is what makes this subpath importable.
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";

let loadPromise: Promise<Ghostty> | null = null;

export function useGhosttyInit(): Promise<Ghostty> {
  if (!loadPromise) {
    loadPromise = Ghostty.load(ghosttyWasmUrl).catch((err) => {
      // Reset so a later caller can retry after a transient network failure.
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}