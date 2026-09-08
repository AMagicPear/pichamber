import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watchFile,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..", "..", "..");
const serverEntry = join(pkgRoot, "packages", "server", "dist", "index.js");
const packageJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string };
export const VERSION = packageJson.version;
export const DEFAULT_PORT = 3000;

// ─── Types shared with commands.ts ───────────────────────────────────────────

export type DaemonPaths = {
  root: string;
  state: string;
  lock: string;
  log: string;
};

/** `/api/health` payload. `app` is absent on a foreign server on the same port. */
export type DaemonHealth = {
  app?: string;
  version: string;
  pid: number;
  startedAt: string;
  instanceId?: string;
};

/** On-disk record of a daemon this CLI started. */
export type DaemonState = {
  pid?: number;
  port: number;
  url: string;
  version: string;
  instanceId: string;
  token: string;
  log: string;
  startedAt: string;
};

export type ProbeResult =
  | { kind: "pichamber"; health: DaemonHealth }
  | { kind: "occupied" }
  | { kind: "free" };

export type EnsureDaemonResult = {
  url: string;
  /** Null when a foreign (unmanaged) server already occupies the port. */
  state: DaemonState | null;
  health: DaemonHealth;
};

/** Free-form JSON the CLI prints: `message` is the human line, the remaining
 *  keys are the `--json` payload. */
export type CliOutput = { message: string } & Record<string, unknown>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stateRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  if (env.PICHAMBER_STATE_DIR) return resolve(env.PICHAMBER_STATE_DIR);
  if (process.platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pichamber");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "pichamber");
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "pichamber");
};

const pathsFor = (port: number): DaemonPaths => ({
  root: stateRoot(),
  state: join(stateRoot(), `daemon-${port}.json`),
  lock: join(stateRoot(), `daemon-${port}.lock`),
  log: join(stateRoot(), `daemon-${port}.log`),
});

const readState = (path: string): DaemonState | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DaemonState;
  } catch {
    return null;
  }
};

const writeState = (path: string, state: DaemonState) => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withLock = async <T>(paths: DaemonPaths, fn: () => Promise<T>): Promise<T> => {
  mkdirSync(paths.root, { recursive: true });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      mkdirSync(paths.lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(paths.lock).mtimeMs > 20_000) rmSync(paths.lock, { recursive: true });
      } catch {
        // The lock disappeared between the stat and the remove; retry.
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for another pichamber command");
      await sleep(75);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(paths.lock, { recursive: true, force: true });
  }
};

const requestJson = async <T = unknown>(url: string, init: RequestInit = {}, timeout = 800): Promise<T> => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
};

const isPortOpen = async (port: number): Promise<boolean> => {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) });
    return true;
  } catch {
    return false;
  }
};

const probe = async (port: number): Promise<ProbeResult> => {
  try {
    const health = await requestJson<DaemonHealth>(`http://127.0.0.1:${port}/api/health`);
    return health?.app === "pichamber" ? { kind: "pichamber", health } : { kind: "occupied" };
  } catch {
    return { kind: (await isPortOpen(port)) ? "occupied" : "free" };
  }
};

const assertPackage = () => {
  if (!existsSync(serverEntry)) {
    throw new Error(`server build not found at ${serverEntry}. Reinstall pichamber and try again.`);
  }
};

const stopManaged = async (state: DaemonState, quiet = false): Promise<void> => {
  await requestJson(
    `http://127.0.0.1:${state.port}/api/daemon/shutdown`,
    { method: "POST", headers: { Authorization: `Bearer ${state.token}` } },
    2_000,
  );
  for (let i = 0; i < 40; i++) {
    await sleep(50);
    if ((await probe(state.port)).kind === "free") break;
  }
  if (!quiet) console.log(`Stopped pichamber on http://127.0.0.1:${state.port}`);
};

const ensureDaemon = async (port: number, quiet = false): Promise<EnsureDaemonResult> => {
  assertPackage();
  const paths = pathsFor(port);
  return withLock(paths, async () => {
    let state = readState(paths.state);
    let current = await probe(port);

    if (current.kind === "pichamber") {
      if (!state || state.instanceId !== current.health.instanceId || !state.token) {
        rmSync(paths.state, { force: true });
        return { url: `http://127.0.0.1:${port}`, state: null, health: current.health };
      }
      if (state.version === VERSION) return { url: state.url, state, health: current.health };
      if (!quiet) console.log(`Updating background server from ${state.version} to ${VERSION}...`);
      await stopManaged(state, true);
      rmSync(paths.state, { force: true });
      state = null;
      current = await probe(port);
    }
    if (current.kind === "occupied") throw new Error(`port ${port} is already in use by another application`);

    const token = crypto.randomUUID();
    const instanceId = crypto.randomUUID();
    const logFd = openSync(paths.log, "a", 0o600);
    const child = Bun.spawn([process.execPath, serverEntry], {
      detached: true,
      stdin: "ignore",
      stdout: logFd,
      stderr: logFd,
      windowsHide: true,
      env: {
        ...process.env,
        PICHAMBER_HOST: "127.0.0.1",
        PICHAMBER_PORT: String(port),
        PICHAMBER_VERSION: VERSION,
        PICHAMBER_INSTANCE_ID: instanceId,
        PICHAMBER_DAEMON_TOKEN: token,
      },
    });
    closeSync(logFd);
    child.unref();
    state = {
      pid: child.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      version: VERSION,
      instanceId,
      token,
      log: paths.log,
      startedAt: new Date().toISOString(),
    };
    writeState(paths.state, state);

    let health: DaemonHealth | undefined;
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      const result = await probe(port);
      if (result.kind === "pichamber" && result.health.instanceId === instanceId) {
        health = result.health;
        break;
      }
      if (child.exitCode !== null) break;
    }
    if (!health) {
      child.kill();
      rmSync(paths.state, { force: true });
      throw new Error(`background server failed to start; inspect ${paths.log}`);
    }
    if (!quiet) console.log(`Started pichamber ${VERSION} on ${state.url}`);
    return { url: state.url, state, health };
  });
};

const openBrowser = (url: string) => {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", `start "" "${url.replaceAll('"', '\\"')}"`]]
        : ["xdg-open", [url]];
  const child = Bun.spawn([cmd, ...args], {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });
  child.unref();
};

const workspacePath = (input?: string): string => {
  const path = resolve(input ?? process.cwd());
  try {
    if (!statSync(path).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`workspace is not a directory: ${path}`);
  }
  return path;
};

const emit = (value: CliOutput, json: boolean) => {
  console.log(json ? JSON.stringify(value) : value.message);
};

const showLogs = async (port: number, lines: number, follow: boolean): Promise<void> => {
  const path = pathsFor(port).log;
  if (!existsSync(path)) throw new Error(`no log file for port ${port}`);
  const content = readFileSync(path, "utf8");
  const initial = content.split(/\r?\n/).slice(-(lines + 1)).join("\n");
  if (initial) process.stdout.write(initial.endsWith("\n") ? initial : `${initial}\n`);
  if (!follow) return;
  let offset = Buffer.byteLength(content);
  console.log(`Following ${path} (Ctrl+C to stop)`);
  watchFile(path, { interval: 300 }, () => {
    const size = statSync(path).size;
    if (size < offset) offset = 0;
    if (size === offset) return;
    createReadStream(path, { start: offset, end: size - 1 }).pipe(process.stdout, { end: false });
    offset = size;
  });
  await new Promise<void>(() => {});
};

const runServe = async (options: { port: number; host: string }): Promise<void> => {
  assertPackage();
  const child = Bun.spawn([process.execPath, serverEntry], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      PICHAMBER_HOST: options.host,
      PICHAMBER_PORT: String(options.port),
      PICHAMBER_VERSION: VERSION,
    },
  });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  const code = await child.exited;
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  if (code !== 0) throw new Error(`server exited with code ${code}`);
};

export {
  emit,
  ensureDaemon,
  openBrowser,
  pathsFor,
  probe,
  readState,
  requestJson,
  runServe,
  showLogs,
  stopManaged,
  workspacePath,
};
