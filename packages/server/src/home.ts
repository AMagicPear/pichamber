/**
 * Resolve the current user's home directory in a way that works on macOS,
 * Linux and Windows without depending on `os.homedir()` semantics that vary
 * between runtimes.
 */
export function getHomeDir(): string {
  if (process.env.HOME) return process.env.HOME;
  if (process.env.USERPROFILE) return process.env.USERPROFILE;
  if (process.platform === "win32") {
    const drive = process.env.HOMEDRIVE ?? "C:";
    const path = process.env.HOMEPATH ?? "\\Users\\Default";
    return `${drive}${path}`;
  }
  return "/";
}