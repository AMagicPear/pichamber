import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { McpOverview } from "@amagicpear/pichamber-shared";

type AdapterConfig = {
  loadMcpConfig: (path: string | undefined, cwd: string) => { mcpServers: Record<string, Record<string, unknown>> };
  getServerProvenance: (path: string | undefined, cwd: string) => Map<string, { path: string }>;
  writeProjectServerDisabledOverride: (path: string | undefined, cwd: string, name: string, disabled: boolean) => unknown;
};
type AdapterCache = { loadMetadataCache: () => { servers: Record<string, { tools?: Array<{ name: string; description?: string }>; resources?: Array<{ name: string; description?: string }>; prompts?: Array<{ name: string; description?: string }> }> } | null };

const adapterRoot = () => join(getAgentDir(), "npm", "node_modules", "pi-mcp-adapter", "dist");
const loadAdapter = async () => {
  const root = adapterRoot();
  if (!existsSync(join(root, "config.js"))) return null;
  const [config, cache] = await Promise.all([
    import(pathToFileURL(join(root, "config.js")).href) as Promise<AdapterConfig>,
    import(pathToFileURL(join(root, "metadata-cache.js")).href) as Promise<AdapterCache>,
  ]);
  return { config, cache };
};

export const getMcpOverview = async (cwd: string): Promise<McpOverview> => {
  try {
    const adapter = await loadAdapter();
    if (!adapter) return { available: false, servers: [] };
    const config = adapter.config.loadMcpConfig(undefined, cwd);
    const provenance = adapter.config.getServerProvenance(undefined, cwd);
    const cache = adapter.cache.loadMetadataCache()?.servers ?? {};
    return {
      available: true,
      servers: Object.entries(config.mcpServers).map(([name, definition]) => {
        const metadata = cache[name];
        const disabled = definition.disabled === true;
        return {
          name,
          source: provenance.get(name)?.path,
          transport: typeof definition.url === "string" ? "http" : typeof definition.socket === "string" ? "socket" : "stdio",
          status: disabled ? "disabled" : metadata ? "cached" : "not-connected",
          disabled,
          directTools: definition.directTools === true || Array.isArray(definition.directTools) ? definition.directTools as boolean | string[] : false,
          toolCount: disabled ? 0 : metadata?.tools?.length ?? 0,
          resourceCount: disabled ? 0 : metadata?.resources?.length ?? 0,
          promptCount: disabled ? 0 : metadata?.prompts?.length ?? 0,
          tools: disabled ? [] : metadata?.tools ?? [],
          resources: disabled ? [] : metadata?.resources ?? [],
          prompts: disabled ? [] : metadata?.prompts ?? [],
        };
      }),
    };
  } catch (error) {
    return { available: false, servers: [], error: error instanceof Error ? error.message : String(error) };
  }
};

export const setMcpServerEnabled = async (cwd: string, name: string, enabled: boolean) => {
  const adapter = await loadAdapter();
  if (!adapter) throw new Error("pi-mcp-adapter is not installed");
  const config = adapter.config.loadMcpConfig(undefined, cwd);
  if (!config.mcpServers[name]) throw new Error(`Unknown MCP server: ${name}`);
  adapter.config.writeProjectServerDisabledOverride(undefined, cwd, name, !enabled);
};
