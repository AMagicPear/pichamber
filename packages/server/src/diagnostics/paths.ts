/**
 * Platform-aware pichamber state-directory resolver.
 *
 * Mirrors the CLI's `stateRoot` so server files land under the same root
 * the user sees in `~/Library/Application Support/pichamber` etc. The CLI
 * is the canonical source of this mapping — keep these two in sync if the
 * paths ever change.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

const stateRoot = () => {
  const env = process.env;
  if (env.PICHAMBER_STATE_DIR) return resolve(env.PICHAMBER_STATE_DIR);
  if (process.platform === "win32") return resolve(env.LOCALAPPDATA ?? `${homedir()}\\AppData\\Local`, "pichamber");
  if (process.platform === "darwin") return resolve(`${homedir()}/Library/Application Support`, "pichamber");
  return resolve(env.XDG_STATE_HOME ?? `${homedir()}/.local/state`, "pichamber");
};

export const getDiagnosticsStateDir = () => stateRoot();
export const getDiagnosticsLogDir = () => resolve(stateRoot(), "logs");
export const getDiagnosticsExportDir = () => resolve(stateRoot(), "diagnostics");