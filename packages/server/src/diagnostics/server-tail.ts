/**
 * Read a bounded tail of recent JSONL events for export.
 *
 * Reads the most recent N events across the rolling day files. The output
 * is plain JSON-serialisable objects; the export endpoint hands them to
 * the browser in a single payload.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiagnosticEvent } from "@amagicpear/pichamber-shared";
import { getDiagnosticsLogDir } from "./paths";

const MAX_TAIL_BYTES = 2 * 1024 * 1024;

const listLogFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((name) => name.startsWith("server-") && name.endsWith(".jsonl"))
      .sort((a, b) => a.localeCompare(b))
      .reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

/** Reads from newest file backwards until `tail` events or `MAX_TAIL_BYTES`
 *  have been collected. Returns events in chronological order. */
export const readServerTail = async (tail: number): Promise<DiagnosticEvent[]> => {
  const dir = getDiagnosticsLogDir();
  const files = await listLogFiles(dir);
  const collected: DiagnosticEvent[] = [];
  let totalBytes = 0;
  outer: for (const name of files) {
    const filePath = join(dir, name);
    const content = await readFile(filePath, "utf8").catch(() => "");
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line) continue;
      totalBytes += line.length + 1;
      try {
        const parsed = JSON.parse(line) as DiagnosticEvent;
        collected.push(parsed);
      } catch {
        /* skip malformed lines */
      }
      if (collected.length >= tail || totalBytes >= MAX_TAIL_BYTES) break outer;
    }
  }
  return collected.reverse();
};