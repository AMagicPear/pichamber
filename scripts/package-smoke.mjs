import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pichamber-package-"));
const prefix = join(root, "install");
const state = join(root, "state");
const agent = join(root, "agent");
const workspace = join(root, "workspace");
mkdirSync(workspace, { recursive: true });

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
};

let cli;
let port;
let tarball;
const env = {
  ...process.env,
  PICHAMBER_STATE_DIR: state,
  PI_CODING_AGENT_DIR: agent,
  PI_CODING_AGENT_SESSION_DIR: join(agent, "sessions"),
};

try {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  run("npm", ["pack"], { cwd: process.cwd() });
  const archiveName = `${packageJson.name.replace(/^@/, "").replace("/", "-")}-${packageJson.version}.tgz`;
  tarball = join(process.cwd(), archiveName);
  run("npm", ["install", "--prefix", prefix, "--ignore-scripts", tarball]);
  rmSync(tarball, { force: true });

  cli = process.platform === "win32"
    ? join(prefix, "node_modules", ".bin", "pichamber.cmd")
    : join(prefix, "node_modules", ".bin", "pichamber");

  const reservation = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["-e", "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    child.stdout.once("data", (chunk) => resolvePromise({ child, port: Number(chunk.toString().trim()) }));
    child.once("error", reject);
  });
  port = reservation.port;
  reservation.child.kill();

  const opened = JSON.parse(run(cli, [workspace, "--port", String(port), "--no-open", "--json"], { env }));
  if (opened.cwd !== realpathSync(workspace) || !opened.sessionId || !opened.url.includes(String(port))) {
    throw new Error(`unexpected open result: ${JSON.stringify(opened)}`);
  }

  const status = JSON.parse(run(cli, ["status", "--port", String(port), "--json"], { env }));
  if (!status.running || !status.managed || status.version !== packageJson.version) {
    throw new Error(`unexpected status result: ${JSON.stringify(status)}`);
  }

  const startedAgain = JSON.parse(run(cli, ["start", "--port", String(port), "--json"], { env }));
  if (!startedAgain.running || startedAgain.pid !== status.pid) {
    throw new Error(`background server was not reused: ${JSON.stringify(startedAgain)}`);
  }

  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
  if (health.app !== "pichamber" || health.version !== packageJson.version) {
    throw new Error(`unexpected health result: ${JSON.stringify(health)}`);
  }

  const html = await fetch(`http://127.0.0.1:${port}/${opened.sessionId}`).then((response) => response.text());
  if (!html.includes('<div id="app">')) throw new Error("installed server did not serve the web app");

  run(cli, ["logs", "--port", String(port), "--lines", "5"], { env });
  run(cli, ["stop", "--port", String(port), "--json"], { env });
  console.log(`Package smoke passed on port ${port}`);
} finally {
  if (cli && port) spawnSync(cli, ["stop", "--port", String(port), "--json"], { env, stdio: "ignore" });
  if (tarball) rmSync(tarball, { force: true });
  rmSync(root, { recursive: true, force: true });
}
