#!/usr/bin/env bun

import { createProgram } from "./commands";
import {
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
  VERSION,
  DEFAULT_PORT,
} from "./daemon";

const program = createProgram({
  version: VERSION,
  defaultPort: DEFAULT_PORT,
  ensureDaemon,
  workspacePath,
  requestJson,
  emit,
  openBrowser,
  pathsFor,
  readState,
  probe,
  stopManaged,
  showLogs,
  runServe,
});

program.parseAsync(process.argv).catch((e) => {
  if (e.code === "commander.version") process.exit(0);
  if (e.code === "commander.help") process.exit(0);
  console.error(`pichamber: ${e.message}`);
  process.exit(e.exitCode ?? 1);
});
