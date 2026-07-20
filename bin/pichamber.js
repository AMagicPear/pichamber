#!/usr/bin/env node
// Pichamber launcher.
//
// pichamber runs its backend via Bun. When invoked through npm/Node we detect
// whether `bun` is on PATH and exec into it; otherwise we surface a helpful
// message so the user knows what to install.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the package root: ../../ relative to bin/pichamber.js.
const pkgRoot = join(__dirname, "..");
const serverEntry = join(pkgRoot, "src-server", "server.ts");

if (!existsSync(serverEntry)) {
  console.error(
    `pichamber: cannot find ${serverEntry}.\n` +
      `If you installed pichamber globally, please reinstall to refresh files.`,
  );
  process.exit(1);
}

function tryResolve(cmd) {
  const path = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of path.split(sep)) {
    if (!dir) continue;
    const full = join(dir, cmd);
    if (existsSync(full)) return full;
  }
  return null;
}

// Prefer `bun` — that's what the server is written for. If absent, try
// Node directly: the backend is plain ESM TypeScript imports only resolvable by
// Bun in practice, so fall back to a clear error.
const bunPath = tryResolve("bun");
if (!bunPath) {
  console.error(
    "pichamber: Bun is required to run pichamber's backend.\n" +
      "Install Bun (https://bun.sh) and try again.",
  );
  process.exit(1);
}

const child = spawn(bunPath, ["run", serverEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error(`pichamber: failed to start bun: ${err.message}`);
  process.exit(1);
});
