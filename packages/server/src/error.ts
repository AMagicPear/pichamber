// `catch` variables are `unknown` since TS 4.0. This is the single
// narrowing site — every throw in this codebase is an `Error`.
export const toMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class RuntimeModeError extends Error {
  readonly status = 409;

  constructor(readonly requiredMode: "sdk" | "rpc") {
    super(`This operation requires the ${requiredMode.toUpperCase()} runtime.`);
    this.name = "RuntimeModeError";
  }
}
