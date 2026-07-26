// `catch` variables are `unknown` since TS 4.0. This is the single
// narrowing site — every throw in this codebase is an `Error`.
export const toMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
