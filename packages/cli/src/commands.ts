import { Command } from "commander";
import { rmSync } from "node:fs";

type CliDeps = {
  version: string;
  defaultPort: number;
  ensureDaemon: any;
  workspacePath: any;
  requestJson: any;
  emit: any;
  openBrowser: any;
  pathsFor: any;
  readState: any;
  probe: any;
  stopManaged: any;
  showLogs: any;
  runServe: any;
};

export const createProgram = (deps: CliDeps) => {
  const program = new Command();
  program.name("pichamber").version(deps.version).description("A browser-based workspace for the Pi Coding Agent").exitOverride().option("-p, --port <port>", "server port", String(deps.defaultPort)).option("--json", "emit machine-readable JSON output");
  program.command("open [path]").description("Open a new session for path (defaults to cwd)").action(async (path) => {
    const opts = program.opts();
    const daemon = await deps.ensureDaemon(Number(opts.port), opts.json);
    const cwd = deps.workspacePath(path);
    const session = await deps.requestJson(`${daemon.url}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }) }, 15_000);
    const url = `${daemon.url}/${encodeURIComponent(session.sessionId)}`;
    deps.emit({ url, cwd: session.cwd, sessionId: session.sessionId, message: `Opened ${session.cwd}\n${url}` }, opts.json);
    if (!opts.json) deps.openBrowser(url);
  });
  program.command("start").description("Start the background server").action(async () => {
    const opts = program.opts();
    const daemon = await deps.ensureDaemon(Number(opts.port), opts.json);
    deps.emit({ running: true, url: daemon.url, pid: daemon.health.pid, version: daemon.health.version, message: `pichamber is running at ${daemon.url}` }, opts.json);
  });
  program.command("stop").description("Stop the background server").action(async () => {
    const opts = program.opts(); const port = Number(opts.port); const paths = deps.pathsFor(port); const state = deps.readState(paths.state); const current = await deps.probe(port);
    if (current.kind !== "pichamber") { rmSync(paths.state, { force: true }); deps.emit({ stopped: false, port, message: `pichamber is not running on port ${port}` }, opts.json); return; }
    if (!state || state.instanceId !== current.health.instanceId || !state.token) throw new Error(`pichamber on port ${port} was not started by this CLI and cannot be stopped safely`);
    await deps.stopManaged(state, opts.json); rmSync(paths.state, { force: true });
    if (opts.json) console.log(JSON.stringify({ stopped: true, port }));
  });
  program.command("status").description("Show background server status").action(async () => {
    const opts = program.opts(); const port = Number(opts.port); const state = deps.readState(deps.pathsFor(port).state); const current = await deps.probe(port);
    if (current.kind !== "pichamber") { if (current.kind === "free") rmSync(deps.pathsFor(port).state, { force: true }); deps.emit({ running: false, port, message: `pichamber is not running on port ${port}` }, opts.json); process.exitCode = 1; return; }
    const managed = state?.instanceId === current.health.instanceId;
    deps.emit({ running: true, managed, url: `http://127.0.0.1:${port}`, pid: current.health.pid, version: current.health.version, startedAt: current.health.startedAt, log: managed ? state.log : undefined, message: `pichamber ${current.health.version} is running (PID ${current.health.pid}) at http://127.0.0.1:${port}` }, opts.json);
  });
  program.command("logs").option("-f, --follow", "follow log output").option("-n, --lines <count>", "number of log lines to show", "80").description("Show background server logs").action(async (options) => deps.showLogs(Number(program.opts().port), Number(options.lines), options.follow));
  program.command("serve").option("--host <host>", "bind address", "127.0.0.1").description("Run the server in the foreground").action(async (options) => deps.runServe({ port: Number(program.opts().port), host: options.host }));
  return program;
};
