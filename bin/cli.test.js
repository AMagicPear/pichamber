import { describe, expect, test } from "bun:test";
import { parseArgs } from "./cli.js";

describe("pichamber CLI arguments", () => {
  test("opens the current directory by default", () => {
    expect(parseArgs([], {})).toMatchObject({ command: "open", path: undefined, port: 3000 });
  });

  test("accepts an implicit workspace path and global options", () => {
    expect(parseArgs(["../project", "--port", "4100", "--no-open"], {})).toMatchObject({
      command: "open",
      path: "../project",
      port: 4100,
      openBrowser: false,
    });
  });

  test("parses daemon and log commands", () => {
    expect(parseArgs(["status", "--port=4200", "--json"], {})).toMatchObject({
      command: "status",
      port: 4200,
      json: true,
    });
    expect(parseArgs(["logs", "-f", "-n", "25"], {})).toMatchObject({
      command: "logs",
      follow: true,
      lines: 25,
    });
    expect(parseArgs(["serve", "--host", "0.0.0.0"], {})).toMatchObject({
      command: "serve",
      host: "0.0.0.0",
    });
  });

  test("uses PICHAMBER_PORT and validates input", () => {
    expect(parseArgs([], { PICHAMBER_PORT: "4300" }).port).toBe(4300);
    expect(() => parseArgs(["--port", "nope"], {})).toThrow("invalid port");
    expect(() => parseArgs(["status", "extra"], {})).toThrow("does not accept");
    expect(() => parseArgs(["--host", "0.0.0.0"], {})).toThrow("only supported");
    expect(() => parseArgs(["--unknown"], {})).toThrow("unknown option");
  });
});
