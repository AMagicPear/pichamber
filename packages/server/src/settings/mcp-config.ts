import { getAgentDir, type AgentSession, type LoadedMcpConfig, type McpExposure } from "@earendil-works/pi-coding-agent";
import type { McpOverview } from "@amagicpear/pichamber-shared";

// 官方尚未从包入口导出配置读写函数；直接复用其模块，避免复制配置合并与信任规则。
const configModule = import(new URL("./extensions/mcp/config.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as Promise<{
  loadMcpConfig: (options: { agentDir: string; cwd: string; projectTrusted: boolean }) => LoadedMcpConfig;
  updateMcpServerConfig: (path: string, name: string, patch: { enabled?: boolean; exposure?: McpExposure }, options?: { override?: boolean }) => void;
}>;

const loadConfig = async (session: AgentSession) => (await configModule).loadMcpConfig({
  agentDir: getAgentDir(),
  cwd: session.sessionManager.getCwd(),
  projectTrusted: session.extensionRunner.createContext().isProjectTrusted(),
});

export const runMcpCommand = async (session: AgentSession, args: string) => {
  const runner = session.extensionRunner;
  const command = runner.getCommand("mcp");
  if (!command || command.sourceInfo.path !== "builtin:mcp") throw new Error("Built-in MCP is disabled or replaced by an extension");
  const context = runner.createCommandContext();
  const messages: string[] = [];
  await command.handler(args, {
    ...context,
    mode: "rpc",
    ui: {
      ...context.ui,
      notify: (message, type) => {
        if (type === "error") throw new Error(message);
        messages.push(message);
        if (args) context.ui.notify(message, type);
      },
    },
  });
  return messages.join("\n");
};

export const getMcpOverview = async (session: AgentSession): Promise<McpOverview> => {
  try {
    const [config, status] = await Promise.all([loadConfig(session), runMcpCommand(session, "")]);
    const tools = session.getAllTools();
    // /mcp 的非 TUI 状态是官方提供的运行时快照；这里只解析最终展示字段。
    const states = new Map([...status.matchAll(/^([\w-]+): (needs sign-in|[\w-]+)[^\n]*(?:\n {4}[^\n]*)*/gm)].map((match) => [match[1]!, match]));
    const entries = [...config.servers];
    for (const server of session.resourceLoader.getExtensions().runtime.mcpServers.list()) {
      if (!entries.some((entry) => entry.name.replaceAll("-", "_") === server.name.replaceAll("-", "_"))) {
        entries.push({ name: server.name, config: server.config, source: server.extensionPath, scope: "extension" });
      }
    }
    return {
      available: true,
      error: config.errors.length ? config.errors.join("\n") : undefined,
      servers: entries.map((entry) => {
        const state = states.get(entry.name);
        const namespace = `mcp__${entry.name.replace(/[^\w]/g, "_")}`;
        const serverTools = entry.config.enabled === false ? [] : tools.filter((tool) => tool.namespace?.name === namespace && tool.exposure !== "hidden");
        return {
          name: entry.name,
          source: entry.override ?? entry.source,
          transport: "url" in entry.config ? "http" : "stdio",
          status: state?.[2] === "needs sign-in" ? "needs-auth" : state?.[2] ?? "starting",
          disabled: entry.config.enabled === false,
          configurable: entry.scope !== "extension",
          canAuthenticate: "url" in entry.config && !entry.config.auth && !Object.keys(entry.config.headers ?? {}).some((key) => key.toLowerCase() === "authorization"),
          exposure: entry.config.exposure ?? "codemode",
          toolCount: Number(state?.[0].match(/, (\d+) tools/)?.[1] ?? serverTools.length),
          tools: serverTools.map((tool) => ({ name: tool.name, description: tool.description, exposure: tool.exposure })),
          error: state?.[0].split("\n").slice(1).map((line) => line.trim()).join("\n") || undefined,
        };
      }),
    };
  } catch (error) {
    return { available: false, servers: [], error: error instanceof Error ? error.message : String(error) };
  }
};

export const updateMcpServer = async (session: AgentSession, name: string, patch: { enabled?: boolean; exposure?: McpExposure }) => {
  if (session.isStreaming || session.isCompacting) throw new Error("Wait for the current run before changing MCP configuration");
  const config = await loadConfig(session);
  const entry = config.servers.find((server) => server.name === name);
  if (!entry) throw new Error(`Unknown file-configured MCP server: ${name}`);
  await runMcpCommand(session, "");
  const override = entry.override ?? (entry.scope === "global" ? config.projectConfig : undefined);
  (await configModule).updateMcpServerConfig(override ?? entry.source, name, patch, { override: override !== undefined });
  await session.reload();
};
