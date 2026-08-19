import { Command } from "commander";
import { spawn, spawnSync } from "node:child_process";
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
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const serverEntry = join(pkgRoot, "dist", "server.js");
const packageJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const VERSION = packageJson.version;
const DEFAULT_PORT = 3000;

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

const requestJson = async (url, init = {}, timeout = 800) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
};

const isPortOpen = (port) => new Promise((r) => {
  const s = connect({ host: "127.0.0.1", port });
  s.setTimeout(300, () => r(false));
  s.once("connect", () => { s.destroy(); r(true); });
  s.once("error", () => { s.destroy(); r(false); });
});

const probe = async (port) => {
  try { const h = await requestJson(`http://127.0.0.1:${port}/api/health`); return h?.app === "pichamber" ? { kind: "pichamber", health: h } : { kind: "occupied" }; }
  catch { return { kind: (await isPortOpen(port)) ? "occupied" : "free" }; }
};

const findBun = () => {
  const exe = process.platform === "win32" ? "bun.exe" : "bun";
  const r = spawnSync(exe, ["--version"], { encoding: "utf8", windowsHide: true });
  if (r.error || r.status !== 0) throw new Error("Bun is required. Install it from https://bun.sh and try again.");
  return exe;
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

    const bun = findBun();
    const token = crypto.randomUUID();
    const instanceId = crypto.randomUUID();
    const logFd = openSync(paths.log, "a", 0o600);
    const child = spawn(bun, ["run", serverEntry], {
      detached: true, stdio: ["ignore", logFd, logFd], windowsHide: true,
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
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => console.warn(`Could not open a browser. Visit ${url}`)); child.unref();
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
  await new Promise(() => {});
};

const runServe = async (options) => {
  assertPackage();
  const bun = findBun();
  const child = spawn(bun, ["run", serverEntry], {
    stdio: "inherit", windowsHide: true,
    env: { ...process.env, PICHAMBER_HOST: options.host, PICHAMBER_PORT: String(options.port), PICHAMBER_VERSION: VERSION },
  });
  const fwd = (s) => child.kill(s);
  process.once("SIGINT", fwd); process.once("SIGTERM", fwd);
  await new Promise((res, rej) => {
    child.once("error", rej);
    child.once("exit", (code, signal) => {
      if (signal === "SIGINT" || signal === "SIGTERM") res();
      else if (signal) rej(new Error(`server stopped by ${signal}`));
      else if (code) rej(new Error(`server exited with code ${code}`));
      else res();
    });
  });
};

// ─── CLI ──────────────────────────────────────────────────────────────────────

const program = new Command();
program
  .name("pichamber")
  .version(VERSION)
  .description("A browser-based workspace for the Pi Coding Agent")
  .exitOverride()
  .option("-p, --port <port>", "server port", String(DEFAULT_PORT))
  .option("--json", "emit machine-readable JSON output");

program
  .command("open [path]")
  .description("Open a new session for path (defaults to cwd)")
  .action(async (path) => {
    const opts = program.opts();
    const daemon = await ensureDaemon(Number(opts.port), opts.json);
    const cwd = workspacePath(path);
    const session = await requestJson(`${daemon.url}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }) }, 15_000);
    const url = `${daemon.url}/${encodeURIComponent(session.sessionId)}`;
    emit({ url, cwd: session.cwd, sessionId: session.sessionId, message: `Opened ${session.cwd}\n${url}` }, opts.json);
    if (!opts.json) openBrowser(url);
  });

program.command("start").description("Start the background server").action(async () => {
  const opts = program.opts();
  const daemon = await ensureDaemon(Number(opts.port), opts.json);
  emit({ running: true, url: daemon.url, pid: daemon.health.pid, version: daemon.health.version, message: `pichamber is running at ${daemon.url}` }, opts.json);
});

program.command("stop").description("Stop the background server").action(async () => {
  const opts = program.opts();
  const port = Number(opts.port); const paths = pathsFor(port); const state = readState(paths.state); const current = await probe(port);
  if (current.kind !== "pichamber") { rmSync(paths.state, { force: true }); emit({ stopped: false, port, message: `pichamber is not running on port ${port}` }, opts.json); return; }
  if (!state || state.instanceId !== current.health.instanceId || !state.token) throw new Error(`pichamber on port ${port} was not started by this CLI and cannot be stopped safely`);
  await stopManaged(state, opts.json); rmSync(paths.state, { force: true });
  if (opts.json) console.log(JSON.stringify({ stopped: true, port }));
});

program.command("status").description("Show background server status").action(async () => {
  const opts = program.opts();
  const port = Number(opts.port); const state = readState(pathsFor(port).state); const current = await probe(port);
  if (current.kind !== "pichamber") { if (current.kind === "free") rmSync(pathsFor(port).state, { force: true }); emit({ running: false, port, message: `pichamber is not running on port ${port}` }, opts.json); process.exitCode = 1; return; }
  const managed = state?.instanceId === current.health.instanceId;
  emit({ running: true, managed, url: `http://127.0.0.1:${port}`, pid: current.health.pid, version: current.health.version, startedAt: current.health.startedAt, log: managed ? state.log : undefined, message: `pichamber ${current.health.version} is running (PID ${current.health.pid}) at http://127.0.0.1:${port}` }, opts.json);
});

program.command("logs").option("-f, --follow", "follow log output").option("-n, --lines <count>", "number of log lines to show", "80").description("Show background server logs").action(async (options) => {
  await showLogs(Number(program.opts().port), Number(options.lines), options.follow);
});

program.command("serve").option("--host <host>", "bind address", "127.0.0.1").description("Run the server in the foreground").action(async (options) => {
  await runServe({ port: Number(program.opts().port), host: options.host });
});

export const runCli = () => {
  program.parseAsync(process.argv).catch((e) => {
    if (e.code === "commander.version") process.exit(0);
    if (e.code === "commander.help") process.exit(0);
    console.error(`pichamber: ${e.message}`);
    process.exit(e.exitCode ?? 1);
  });
};
