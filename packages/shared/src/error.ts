/**
 * `catch` variables are `unknown` since TS 4.0. Every throw in this codebase
 * is an `Error`, so this is the single narrowing site, shared by the server
 * and the browser.
 */
export const toMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
