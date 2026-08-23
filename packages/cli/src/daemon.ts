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
const packageJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
export const VERSION = packageJson.version;
export const DEFAULT_PORT = 3000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stateRoot = (env = process.env) => {
  if (env.PICHAMBER_STATE_DIR) return resolve(env.PICHAMBER_STATE_DIR);
  if (process.platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pichamber");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "pichamber");
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "pichamber");
};

const pathsFor = (port) => ({
  root: stateRoot(),
  state: join(stateRoot(), `daemon-${port}.json`),
  lock: join(stateRoot(), `daemon-${port}.lock`),
  log: join(stateRoot(), `daemon-${port}.log`),
});

const readState = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

const writeState = (path, state) => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const withLock = async (paths, fn) => {
  mkdirSync(paths.root, { recursive: true });
  const deadline = Date.now() + 15_000;
  while (true) {
    try { mkdirSync(paths.lock); break; } catch (e) {
      if (e?.code !== "EEXIST") throw e;
      try { if (Date.now() - statSync(paths.lock).mtimeMs > 20_000) rmSync(paths.lock, { recursive: true }); } catch { /* ok */ }
      if (Date.now() >= deadline) throw new Error("timed out waiting for another pichamber command");
      await sleep(75);
    }
  }
  try { return await fn(); } finally { rmSync(paths.lock, { recursive: true, force: true }); }
};

const requestJson = async (url, init = {}, timeout = 800): Promise<any> => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
};

const isPortOpen = async (port) => {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) });
    return true;
  } catch {
    return false;
  }
};

const probe = async (port) => {
  try { const h = await requestJson(`http://127.0.0.1:${port}/api/health`); return h?.app === "pichamber" ? { kind: "pichamber", health: h } : { kind: "occupied" }; }
  catch { return { kind: (await isPortOpen(port)) ? "occupied" : "free" }; }
};

const assertPackage = () => { if (!existsSync(serverEntry)) throw new Error(`server build not found at ${serverEntry}. Reinstall pichamber and try again.`); };

const stopManaged = async (state, quiet = false) => {
  await requestJson(`http://127.0.0.1:${state.port}/api/daemon/shutdown`, { method: "POST", headers: { Authorization: `Bearer ${state.token}` } }, 2_000);
  for (let i = 0; i < 40; i++) { await sleep(50); if ((await probe(state.port)).kind === "free") break; }
  if (!quiet) console.log(`Stopped pichamber on http://127.0.0.1:${state.port}`);
};

const ensureDaemon = async (port, quiet = false) => {
  assertPackage();
  const paths = pathsFor(port);
  return withLock(paths, async () => {
    let state = readState(paths.state);
    let current = await probe(port);

    if (current.kind === "pichamber") {
      const managed = state?.instanceId === current.health.instanceId && state?.token;
      if (!managed) { rmSync(paths.state, { force: true }); return { url: `http://127.0.0.1:${port}`, state: null, health: current.health }; }
      if (state.version === VERSION) return { url: state.url, state, health: current.health };
      if (!quiet) console.log(`Updating background server from ${state.version} to ${VERSION}...`);
      await stopManaged(state, true); rmSync(paths.state, { force: true }); state = null; current = await probe(port);
    }
    if (current.kind === "occupied") throw new Error(`port ${port} is already in use by another application`);

    const token = crypto.randomUUID();
    const instanceId = crypto.randomUUID();
    const logFd = openSync(paths.log, "a", 0o600);
    const child = Bun.spawn([process.execPath, serverEntry], {
      detached: true, stdin: "ignore", stdout: logFd, stderr: logFd,
      env: { ...process.env, PICHAMBER_HOST: "127.0.0.1", PICHAMBER_PORT: String(port), PICHAMBER_VERSION: VERSION, PICHAMBER_INSTANCE_ID: instanceId, PICHAMBER_DAEMON_TOKEN: token },
    });
    closeSync(logFd); child.unref();
    state = { pid: child.pid, port, url: `http://127.0.0.1:${port}`, version: VERSION, instanceId, token, log: paths.log, startedAt: new Date().toISOString() };
    writeState(paths.state, state);

    let lastHealth;
    for (let i = 0; i < 80; i++) { await sleep(100); const r = await probe(port); if (r.kind === "pichamber" && r.health.instanceId === instanceId) { lastHealth = r.health; break; } if (child.exitCode !== null) break; }
    if (!lastHealth) { child.kill(); rmSync(paths.state, { force: true }); throw new Error(`background server failed to start; inspect ${paths.log}`); }
    if (!quiet) console.log(`Started pichamber ${VERSION} on ${state.url}`);
    return { url: state.url, state, health: lastHealth };
  });
};

const openBrowser = (url) => {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", `start "" "${url.replaceAll('"', '\\"')}"`]] : ["xdg-open", [url]];
  const child = Bun.spawn([cmd, ...args], { detached: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  child.unref();
};

const workspacePath = (input) => {
  const path = resolve(input ?? process.cwd());
  try { if (!statSync(path).isDirectory()) throw new Error("not a directory"); } catch { throw new Error(`workspace is not a directory: ${path}`); }
  return path;
};

const emit = (value, json) => { console.log(json ? JSON.stringify(value) : value.message); };

const showLogs = async (port, lines, follow) => {
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

const runServe = async (options) => {
  assertPackage();
  const child = Bun.spawn([process.execPath, serverEntry], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
    env: { ...process.env, PICHAMBER_HOST: options.host, PICHAMBER_PORT: String(options.port), PICHAMBER_VERSION: VERSION },
  });
  const fwd = (s) => child.kill(s);
  process.once("SIGINT", fwd); process.once("SIGTERM", fwd);
  const code = await child.exited;
  process.off("SIGINT", fwd); process.off("SIGTERM", fwd);
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
