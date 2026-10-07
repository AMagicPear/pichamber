import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createUiBridge } from "../extensions/extension-ui";
import { getMcpOverview, runMcpCommand } from "./mcp-config";

test("official MCP connects registered servers, discovers tools, calls resources, and reconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "pichamber-native-mcp-"));
  const serverCode = `
    const { createInterface } = await import('node:readline');
    createInterface({ input: process.stdin }).on('line', (line) => {
      const message = JSON.parse(line);
      if (message.id === undefined) return;
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : message.method === 'tools/list'
        ? { tools: [{ name: 'echo', description: 'Echo fixture text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }
        : message.method === 'tools/call'
        ? { content: [{ type: 'text', text: message.params.arguments.text }] }
        : message.method === 'resources/list'
        ? { resources: [{ uri: 'test://fixture', name: 'fixture' }] }
        : message.method === 'resources/templates/list'
        ? { resourceTemplates: [] }
        : message.method === 'resources/read'
        ? { contents: [{ uri: 'test://fixture', mimeType: 'text/plain', text: 'resource content' }] }
        : {};
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
    });`;
  const loader = new DefaultResourceLoader({
    cwd: root, agentDir: root, noSkills: true, noContextFiles: true,
    extensionFactories: [
      { name: "codemode", builtin: true, replaceable: true, factory: createCodemodeExtension() },
      { name: "tool-search", builtin: true, replaceable: true, factory: createToolSearchExtension() },
      { name: "mcp", builtin: true, replaceable: true, factory: createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }), logPath: join(root, "mcp.log") }) },
      (pi) => { pi.registerMcpServer("fixture", { command: process.execPath, args: ["--eval", serverCode], exposure: "deferred" }); },
    ],
  });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await loader.reload();
    ({ session } = await createAgentSession({ cwd: root, agentDir: root, resourceLoader: loader, settingsManager: SettingsManager.inMemory(), sessionManager: SessionManager.inMemory(root) }));
    await session.bindExtensions({ mode: "rpc", uiContext: createUiBridge(() => {}).context });
    const overview = await getMcpOverview(session);
    expect(overview.available).toBe(true);
    expect(overview.servers.find((server) => server.name === "fixture")).toMatchObject({ status: "connected", toolCount: 1, exposure: "deferred", configurable: false });
    expect(session.getActiveToolNames()).toContain("tool_search");
    expect(session.getActiveToolNames()).not.toContain("mcp__fixture__echo");
    const context = session.extensionRunner.createToolContext("test", undefined);
    const search = session.extensionRunner.getToolDefinition("tool_search")!;
    await search.execute("search", { query: "fixture echo" }, new AbortController().signal, undefined, context);
    expect(session.getActiveToolNames()).toContain("mcp__fixture__echo");
    const echo = session.extensionRunner.getToolDefinition("mcp__fixture__echo")!;
    const result = await echo.execute("echo", { text: "hello" }, new AbortController().signal, undefined, context);
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    const read = session.extensionRunner.getToolDefinition("read_mcp_resource")!;
    const resource = await read.execute("resource", { server: "fixture", uri: "test://fixture" }, new AbortController().signal, undefined, context);
    expect(JSON.stringify(resource.content)).toContain("resource content");
    await runMcpCommand(session, "reconnect fixture");
    expect(await runMcpCommand(session, "")).toContain("fixture: connected, 1 tools (deferred)");
    expect(JSON.stringify(session.messages)).not.toContain("reconnect fixture");
  } finally {
    if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
