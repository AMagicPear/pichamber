/**
 * Type declarations for Vite asset imports.
 *
 * `import x from './foo.wasm?url'` returns the public URL of the WASM asset.
 * The `ghostty-web` package declares this subpath in its `exports` field, so
 * `import ghosttyWasmUrl from 'ghostty-web/ghostty-vt.wasm?url'` typechecks
 * the same way.
 */
declare module "*?url" {
  const src: string;
  export default src;
}