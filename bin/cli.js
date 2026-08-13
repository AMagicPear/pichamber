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

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = join(pkgRoot, "dist", "server.js");
const packageJson = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const VERSION = packageJson.version;
const DEFAULT_PORT = 3000;
const COMMANDS = new Set(["open", "start", "stop", "status", "logs", "serve"]);

const usage = `pichamber ${VERSION}

Usage:
  pichamber [path]              Open a new session for path
  pichamber open [path]         Open a new session for path
  pichamber start               Start the background server
  pichamber stop                Stop the background server
  pichamber status              Show background server status
  pichamber logs [-f]           Show background server logs
  pichamber serve               Run the server in the foreground

Options:
  -p, --port <port>             Server port (default: 3000)
      --host <host>             Bind address for serve (default: 127.0.0.1)
      --no-open                 Print the URL without opening a browser
      --json                    Emit machine-readable output
  -f, --follow                  Follow logs
  -n, --lines <count>           Number of log lines to show (default: 80)
  -h, --help                    Show help
  -v, --version                 Show version`;

const optionValue = (args, index, inline, option) => {
  if (inline !== undefined) return [inline, index];
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return [value, index + 1];
};

export const parseArgs = (args, env = process.env) => {
  const options = {
    command: "open",
    path: undefined,
    port: Number(env.PICHAMBER_PORT ?? DEFAULT_PORT),
    host: "127.0.0.1",
    openBrowser: true,
    json: false,
    follow: false,
    lines: 80,
    help: false,
    version: false,
  };
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    const [flag, inline] = arg.split(/=(.*)/s, 2);
    if (flag === "-h" || flag === "--help") options.help = true;
    else if (flag === "-v" || flag === "--version") options.version = true;
    else if (flag === "--no-open") options.openBrowser = false;
    else if (flag === "--json") options.json = true;
    else if (flag === "-f" || flag === "--follow") options.follow = true;
    else if (flag === "-p" || flag === "--port") {
      const [value, next] = optionValue(args, i, inline, flag);
      options.port = Number(value);
      i = next;
    } else if (flag === "--host") {
      const [value, next] = optionValue(args, i, inline, flag);
      options.host = value;
      i = next;
    } else if (flag === "-n" || flag === "--lines") {
      const [value, next] = optionValue(args, i, inline, flag);
      options.lines = Number(value);
      i = next;
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else positionals.push(arg);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error(`invalid port: ${options.port}`);
  }
  if (!Number.isInteger(options.lines) || options.lines < 0) {
    throw new Error(`invalid line count: ${options.lines}`);
  }

  if (positionals[0] && COMMANDS.has(positionals[0])) options.command = positionals.shift();
  if (options.command === "open") {
    if (positionals.length > 1) throw new Error("open accepts at most one path");
    options.path = positionals[0];
  } else if (positionals.length) {
    throw new Error(`${options.command} does not accept positional arguments`);
  }
  if (options.host !== "127.0.0.1" && options.command !== "serve") {
    throw new Error("--host is only supported by pichamber serve");
  }
  return options;
};

const stateRoot = (env = process.env) => {
  if (env.PICHAMBER_STATE_DIR) return resolve(env.PICHAMBER_STATE_DIR);
  if (process.platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pichamber");
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "pichamber");
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "pichamber");
};

const pathsFor = (port) => {
  const root = stateRoot();
  return {
    root,
    state: join(root, `daemon-${port}.json`),
    lock: join(root, `daemon-${port}.lock`),
    log: join(root, `daemon-${port}.log`),
  };
};

const readState = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const writeState = (path, state) => {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
};

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const withLock = async (paths, fn) => {
  mkdirSync(paths.root, { recursive: true });
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      mkdirSync(paths.lock);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(paths.lock).mtimeMs > 20_000) rmSync(paths.lock, { recursive: true });
      } catch {
        // The owner may have released the lock between calls.
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

const requestJson = async (url, init = {}, timeout = 800) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
};

const isPortOpen = (port) =>
  new Promise((resolvePromise) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolvePromise(open);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

const probe = async (port) => {
  try {
    const health = await requestJson(`http://127.0.0.1:${port}/api/health`);
    return health?.app === "pichamber" ? { kind: "pichamber", health } : { kind: "occupied" };
  } catch {
    return { kind: (await isPortOpen(port)) ? "occupied" : "free" };
  }
};

const findBun = () => {
  const executable = process.platform === "win32" ? "bun.exe" : "bun";
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error("Bun is required. Install it from https://bun.sh and try again.");
  }
  return executable;
};

const assertPackage = () => {
  if (!existsSync(serverEntry)) {
    throw new Error(`server build not found at ${serverEntry}. Reinstall pichamber and try again.`);
  }
};

const stopManaged = async (state, quiet = false) => {
  await requestJson(
    `http://127.0.0.1:${state.port}/api/daemon/shutdown`,
    { method: "POST", headers: { Authorization: `Bearer ${state.token}` } },
    2_000,
  );
  for (let i = 0; i < 40; i += 1) {
    await sleep(50);
    if ((await probe(state.port)).kind === "free") break;
  }
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
      if (!managed) {
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

    const bun = findBun();
    const token = crypto.randomUUID();
    const instanceId = crypto.randomUUID();
    const logFd = openSync(paths.log, "a", 0o600);
    const child = spawn(bun, ["run", serverEntry], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
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

    let lastHealth;
    for (let i = 0; i < 80; i += 1) {
      await sleep(100);
      const result = await probe(port);
      if (result.kind === "pichamber" && result.health.instanceId === instanceId) {
        lastHealth = result.health;
        break;
      }
      if (child.exitCode !== null) break;
    }
    if (!lastHealth) {
      child.kill();
      rmSync(paths.state, { force: true });
      throw new Error(`background server failed to start; inspect ${paths.log}`);
    }
    if (!quiet) console.log(`Started pichamber ${VERSION} on ${state.url}`);
    return { url: state.url, state, health: lastHealth };
  });
};

const openBrowser = (url) => {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd.exe", ["/d", "/s", "/c", `start "" "${url.replaceAll('"', '\\"')}"`]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => console.warn(`Could not open a browser. Visit ${url}`));
  child.unref();
};

const workspacePath = (input) => {
  const path = resolve(input ?? process.cwd());
  try {
    if (!statSync(path).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`workspace is not a directory: ${path}`);
  }
  return path;
};

const emit = (value, json) => {
  console.log(json ? JSON.stringify(value) : value.message);
};

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
    const stream = createReadStream(path, { start: offset, end: size - 1 });
    stream.pipe(process.stdout, { end: false });
    offset = size;
  });
  await new Promise(() => {});
};

const runServe = async (options) => {
  assertPackage();
  const bun = findBun();
  const child = spawn(bun, ["run", serverEntry], {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      PICHAMBER_HOST: options.host,
      PICHAMBER_PORT: String(options.port),
      PICHAMBER_VERSION: VERSION,
    },
  });
  const forward = (signal) => child.kill(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal === "SIGINT" || signal === "SIGTERM") resolvePromise();
      else if (signal) reject(new Error(`server stopped by ${signal}`));
      else if (code) reject(new Error(`server exited with code ${code}`));
      else resolvePromise();
    });
  });
};

export const runCli = async (argv = process.argv.slice(2)) => {
  const options = parseArgs(argv);
  if (options.help) return console.log(usage);
  if (options.version) return console.log(VERSION);

  if (options.command === "serve") return runServe(options);
  if (options.command === "logs") return showLogs(options.port, options.lines, options.follow);

  if (options.command === "status") {
    const state = readState(pathsFor(options.port).state);
    const current = await probe(options.port);
    if (current.kind !== "pichamber") {
      if (current.kind === "free") rmSync(pathsFor(options.port).state, { force: true });
      emit({ running: false, port: options.port, message: `pichamber is not running on port ${options.port}` }, options.json);
      process.exitCode = 1;
      return;
    }
    const managed = state?.instanceId === current.health.instanceId;
    emit(
      {
        running: true,
        managed,
        url: `http://127.0.0.1:${options.port}`,
        pid: current.health.pid,
        version: current.health.version,
        startedAt: current.health.startedAt,
        log: managed ? state.log : undefined,
        message: `pichamber ${current.health.version} is running (PID ${current.health.pid}) at http://127.0.0.1:${options.port}`,
      },
      options.json,
    );
    return;
  }

  if (options.command === "stop") {
    const paths = pathsFor(options.port);
    const state = readState(paths.state);
    const current = await probe(options.port);
    if (current.kind !== "pichamber") {
      rmSync(paths.state, { force: true });
      emit({ stopped: false, port: options.port, message: `pichamber is not running on port ${options.port}` }, options.json);
      return;
    }
    if (!state || state.instanceId !== current.health.instanceId || !state.token) {
      throw new Error(`pichamber on port ${options.port} was not started by this CLI and cannot be stopped safely`);
    }
    await stopManaged(state, options.json);
    rmSync(paths.state, { force: true });
    if (options.json) console.log(JSON.stringify({ stopped: true, port: options.port }));
    return;
  }

  const daemon = await ensureDaemon(options.port, options.json);
  if (options.command === "start") {
    emit(
      { running: true, url: daemon.url, pid: daemon.health.pid, version: daemon.health.version, message: `pichamber is running at ${daemon.url}` },
      options.json,
    );
    return;
  }

  const cwd = workspacePath(options.path);
  const session = await requestJson(`${daemon.url}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  }, 15_000);
  const url = `${daemon.url}/${encodeURIComponent(session.sessionId)}`;
  emit({ url, cwd: session.cwd, sessionId: session.sessionId, message: `Opened ${session.cwd}\n${url}` }, options.json);
  if (options.openBrowser) openBrowser(url);
};
