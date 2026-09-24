// `toMessage` lives in shared so the server and the browser narrow `unknown`
// the same way; re-exported here so existing `../error` imports keep working.
export { toMessage } from "@amagicpear/pichamber-shared";

export class RuntimeModeError extends Error {
  readonly status = 409;

  constructor(readonly requiredMode: "sdk" | "rpc") {
    super(`This operation requires the ${requiredMode.toUpperCase()} runtime.`);
    this.name = "RuntimeModeError";
  }
}
