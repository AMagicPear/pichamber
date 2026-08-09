#!/usr/bin/env node
// Pichamber launcher.
//
// pichamber's backend runs on Bun. When invoked through npm/Node we look
// for `bun` on PATH and exec into it; otherwise we surface a helpful
// message so the user knows what to install.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = join(pkgRoot, "dist", "server.js");

if (!existsSync(serverEntry)) {
  console.error(
    `pichamber: cannot find ${serverEntry}.\n` +
      `If you installed pichamber globally, please reinstall to refresh files.`,
  );
  process.exit(1);
}

const findOnPath = (cmd) => {
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of (process.env.PATH ?? "").split(sep)) {
    if (!dir) continue;
    const full = join(dir, cmd);
    if (existsSync(full)) return full;
  }
  return null;
};

const bunPath = findOnPath(process.platform === "win32" ? "bun.exe" : "bun");
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
