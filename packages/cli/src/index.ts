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

program.parseAsync(process.argv).catch((error: unknown) => {
  const code = (error as { code?: string }).code;
  if (code === "commander.version" || code === "commander.help") process.exit(0);
  console.error(`pichamber: ${(error as Error).message}`);
  process.exit((error as { exitCode?: number }).exitCode ?? 1);
});
