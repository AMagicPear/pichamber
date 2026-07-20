import { describe, expect, it } from "vitest";
import {
  coerceToText,
  detectLanguageFromOutput,
  formatEditOutput,
  formatToolInput,
  getRelativePath,
  tryParseJsonOutput,
} from "./toolRenderers";

describe("toolRenderers", () => {
  it("coerceToText flattens objects to JSON", () => {
    expect(coerceToText({ a: 1 })).toBe('{"a":1}');
    expect(coerceToText("hi")).toBe("hi");
    expect(coerceToText(null, "fallback")).toBe("fallback");
    expect(coerceToText(undefined)).toBe("");
  });

  it("tryParseJsonOutput detects JSON objects and arrays", () => {
    expect(tryParseJsonOutput('{"a":1}').isJson).toBe(true);
    expect(tryParseJsonOutput('[1,2,3]').isJson).toBe(true);
    expect(tryParseJsonOutput('not json').isJson).toBe(false);
    expect(tryParseJsonOutput('').isJson).toBe(false);
    expect(tryParseJsonOutput('"quoted"').isJson).toBe(false);
  });

  it("detectLanguageFromOutput picks bash for shell output", () => {
    expect(detectLanguageFromOutput("hello world", "bash")).toBe("bash");
    expect(detectLanguageFromOutput("hello world", "shell")).toBe("bash");
  });

  it("detectLanguageFromOutput picks json when output parses", () => {
    expect(detectLanguageFromOutput('{"ok":true}', "exec")).toBe("json");
    expect(detectLanguageFromOutput('plain text', "exec")).toBe("text");
  });

  it("detectLanguageFromOutput picks diff for unified diffs", () => {
    expect(detectLanguageFromOutput("--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n", "edit")).toBe("diff");
  });

  it("formatEditOutput strips Pi's <file> envelope and line prefixes", () => {
    expect(formatEditOutput("<file>\n00001|hello\n00002|world\n</file>")).toBe("hello\nworld");
    expect(formatEditOutput("just content")).toBe("just content");
  });

  it("formatToolInput shortens long strings and uses tool-specific fields", () => {
    expect(formatToolInput({ command: "ls -la" }, "bash")).toBe("ls -la");
    expect(formatToolInput({ path: "/a/b/c.ts" }, "read")).toBe("/a/b/c.ts");
    expect(formatToolInput({ pattern: "TODO" }, "grep")).toBe("TODO");
    expect(formatToolInput({ url: "https://example.com" }, "fetch")).toBe("https://example.com");
    expect(formatToolInput({ description: "do thing" }, "task")).toBe("do thing");
    const longCmd = "x".repeat(200);
    const out = formatToolInput({ command: longCmd }, "bash");
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith("…")).toBe(true);
  });

  it("getRelativePath strips cwd prefix", () => {
    expect(getRelativePath("/Users/me/proj/src/foo.ts", "/Users/me/proj")).toBe("src/foo.ts");
    expect(getRelativePath("/Users/me/proj/src/foo.ts", "")).toBe("/Users/me/proj/src/foo.ts");
    expect(getRelativePath("/Users/me/proj", "/Users/me/proj")).toBe(".");
    expect(getRelativePath("/other/path/foo.ts", "/Users/me/proj")).toBe("/other/path/foo.ts");
  });
});