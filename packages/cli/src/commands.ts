import { Command } from "commander";
import { rmSync } from "node:fs";
import type {
  CliOutput,
  DaemonPaths,
  DaemonState,
  EnsureDaemonResult,
  ProbeResult,
} from "./daemon";

/** Injected by `index.ts` so this module stays free of process/daemon
 *  side effects and can be exercised with fakes in tests. */
type CliDeps = {
  version: string;
  defaultPort: number;
  ensureDaemon: (port: number, quiet?: boolean) => Promise<EnsureDaemonResult>;
  workspacePath: (input?: string) => string;
  requestJson: <T>(url: string, init?: RequestInit, timeout?: number) => Promise<T>;
  emit: (value: CliOutput, json: boolean) => void;
  openBrowser: (url: string) => void;
  pathsFor: (port: number) => DaemonPaths;
  readState: (path: string) => DaemonState | null;
  probe: (port: number) => Promise<ProbeResult>;
  stopManaged: (state: DaemonState, quiet?: boolean) => Promise<void>;
  showLogs: (port: number, lines: number, follow: boolean) => Promise<void>;
  runServe: (options: { port: number; host: string }) => Promise<void>;
};

type GlobalOptions = { port: string; json?: boolean };

export const createProgram = (deps: CliDeps) => {
  const program = new Command();
  program
    .name("pichamber")
    .version(deps.version)
    .description("A browser-based workspace for the Pi Coding Agent")
    .exitOverride()
    .option("-p, --port <port>", "server port", String(deps.defaultPort))
    .option("--json", "emit machine-readable JSON output");

  const options = () => program.opts<GlobalOptions>();
  const port = () => Number(options().port);
  const json = () => Boolean(options().json);

  program
    .command("open [path]")
    .description("Open a new session for path (defaults to cwd)")
    .action(async (path?: string) => {
      const daemon = await deps.ensureDaemon(port(), json());
      const cwd = deps.workspacePath(path);
      const session = await deps.requestJson<{ sessionId: string; cwd: string }>(
        `${daemon.url}/api/sessions`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd }) },
        15_000,
      );
      const url = `${daemon.url}/${encodeURIComponent(session.sessionId)}`;
      deps.emit(
        { url, cwd: session.cwd, sessionId: session.sessionId, message: `Opened ${session.cwd}\n${url}` },
        json(),
      );
      if (!json()) deps.openBrowser(url);
    });

  program
    .command("start")
    .description("Start the background server")
    .action(async () => {
      const daemon = await deps.ensureDaemon(port(), json());
      deps.emit(
        {
          running: true,
          url: daemon.url,
          pid: daemon.health.pid,
          version: daemon.health.version,
          message: `pichamber is running at ${daemon.url}`,
        },
        json(),
      );
    });

  program
    .command("stop")
    .description("Stop the background server")
    .action(async () => {
      const target = port();
      const paths = deps.pathsFor(target);
      const state = deps.readState(paths.state);
      const current = await deps.probe(target);
      if (current.kind !== "pichamber") {
        rmSync(paths.state, { force: true });
        deps.emit({ stopped: false, port: target, message: `pichamber is not running on port ${target}` }, json());
        return;
      }
      if (!state || state.instanceId !== current.health.instanceId || !state.token) {
        throw new Error(`pichamber on port ${target} was not started by this CLI and cannot be stopped safely`);
      }
      await deps.stopManaged(state, json());
      rmSync(paths.state, { force: true });
      if (json()) console.log(JSON.stringify({ stopped: true, port: target }));
    });

  program
    .command("status")
    .description("Show background server status")
    .action(async () => {
      const target = port();
      const paths = deps.pathsFor(target);
      const state = deps.readState(paths.state);
      const current = await deps.probe(target);
      if (current.kind !== "pichamber") {
        if (current.kind === "free") rmSync(paths.state, { force: true });
        deps.emit({ running: false, port: target, message: `pichamber is not running on port ${target}` }, json());
        process.exitCode = 1;
        return;
      }
      const managed = state?.instanceId === current.health.instanceId;
      deps.emit(
        {
          running: true,
          managed,
          url: `http://127.0.0.1:${target}`,
          pid: current.health.pid,
          version: current.health.version,
          startedAt: current.health.startedAt,
          log: managed ? state?.log : undefined,
          message: `pichamber ${current.health.version} is running (PID ${current.health.pid}) at http://127.0.0.1:${target}`,
        },
        json(),
      );
    });

  program
    .command("logs")
    .option("-f, --follow", "follow log output")
    .option("-n, --lines <count>", "number of log lines to show", "80")
    .description("Show background server logs")
    .action(async (commandOptions: { lines: string; follow?: boolean }) => {
      await deps.showLogs(port(), Number(commandOptions.lines), Boolean(commandOptions.follow));
    });

  program
    .command("serve")
    .option("--host <host>", "bind address", "127.0.0.1")
    .description("Run the server in the foreground")
    .action(async (commandOptions: { host: string }) => {
      await deps.runServe({ port: port(), host: commandOptions.host });
    });

  return program;
};
