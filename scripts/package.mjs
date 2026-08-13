import { cpSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("bun", ["run", "build:web"]);
rmSync("dist", { recursive: true, force: true });
rmSync("dist-web", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
run("bun", [
  "build",
  "packages/server/src/index.ts",
  "--outfile",
  "dist/server.js",
  "--target",
  "bun",
  "--external",
  "bun-pty",
  "--external",
  "@earendil-works/pi-coding-agent",
]);
cpSync("packages/web/dist", "dist-web", { recursive: true });
