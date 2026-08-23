import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const runCli = async (...args) => {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: join(import.meta.dir, "../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
};

describe("pichamber CLI", () => {
  test("prints Commander help without starting a server", async () => {
    const result = await runCli("--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("open [path]");
    expect(result.stdout).toContain("serve");
  });

  test("prints the package version", async () => {
    const result = await runCli("--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("reports unknown commands through Commander", async () => {
    const result = await runCli("unknown-command");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown command");
  });
});
