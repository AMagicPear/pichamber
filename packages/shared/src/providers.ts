/**
 * Pi 提供商 / 配额 / 行为设置 / 扩展包 的 wire 类型。
 *
 * 这些是 Settings 面板与配额面板读的「pi 本身」数据视图，与活会话
 * （`session.ts`）和 pichamber 自有功能（git/fs/pty/`server.ts`）分开。
 */

/** One slice of a provider's quota — e.g. MiniMax's 5-hour window. */
export type QuotaWindow = {
  /** Short label rendered in the panel ("5h", "Weekly", …). */
  label: string;
  /** Fraction of the window already consumed, in [0, 1]. */
  utilization: number;
  /** Unix ms when this window resets to 0. `0` when the provider has no
   *  reset concept (e.g. DeepSeek's pay-as-you-go balance). */
  resetsAt: number;
  /** Optional free-form override: when a provider's quota isn't really
   *  "utilization of a window" (DeepSeek's balance), the panel shows
   *  this string instead of a progress bar. */
  display?: string;
  /** Amount consumed in this window, when the upstream API reports it. */
  used?: number;
  /** Amount that defines the window limit, when known. */
  limit?: number;
  /** Unit for `used` and `limit` (e.g. "USD", "CNY", "tokens"). */
  unit?: string;
};

/** Successful quota snapshot for a provider. */
export type QuotaSnapshot = {
  provider: string;
  windows: QuotaWindow[];
  /** Unix ms when the server last fetched this from the upstream API. */
  fetchedAt: number;
};

/** Error payload when quota lookup fails (missing key, upstream down,
 *  provider not supported yet, …). Kept in the same shape as a snapshot
 *  minus `windows` so the panel can render a single "not available"
 *  row instead of branching across two record types. */
export type ProviderQuota =
  | (QuotaSnapshot & { error?: undefined })
  | (Omit<QuotaSnapshot, "windows"> & { error: string; windows?: undefined });

/** Provider metadata shared by model and quota surfaces. The display name is
 * resolved from Pi's provider registry on the server; clients must not
 * derive it from ids or adapter labels. */
export type ProviderDescriptor = {
  id: string;
  name: string;
};

/** Credential-safe provider view for the Settings screen. Keys and OAuth
 * tokens never leave the server; this only describes Pi's resolved status. */
export type PiProviderSettings = {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  modelCount: number;
  auth: {
    configured: boolean;
    supportsApiKey: boolean;
    canRemove: boolean;
    source?: string;
    label?: string;
  };
};

/** Pi runtime behavior settings persisted by Pi's SettingsManager. */
export type PiBehaviorSettings = {
  autoCompaction: boolean;
  autoRetry: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  transport: "auto" | "sse" | "websocket" | "websocket-cached";
  httpIdleTimeoutMs: number;
};

/** A package or local source configured through Pi's package manager. */
export type PiExtensionSource = {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
  /** Version read from the installed package manifest, when available. */
  version?: string;
};

/** An installed Pi package with a newer registry or remote revision available. */
export type PiExtensionUpdate = {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: "user" | "project";
};

/** A package shown in the app-market browser (pi.dev/packages gallery, or npm fallback). */
export type PiMarketplacePackage = {
  /** npm package name, e.g. `pi-mcp-adapter` or `@scope/pkg`. */
  name: string;
  description: string;
  /** First author / maintainer name. */
  author: string;
  /** Resource types it ships, e.g. `["extension", "skill"]`. */
  types: string[];
  /** Monthly downloads, when the source reports them. */
  downloads?: number;
  /** Publish date (ISO 8601), when known. */
  date?: string;
  /** Install spec to pass to `installPiExtensionSource` (always `npm:<name>`). */
  source: string;
};

/** One page of the app-market catalog, normalized for the settings UI. */
export type PiMarketplaceResult = {
  packages: PiMarketplacePackage[];
  total: number;
  page: number;
  /** Where the catalog was read from — the official gallery, or the npm fallback. */
  source: "pi.dev" | "npm";
};

/** Wire payload from the server's app-market endpoint.
 *  `pi.dev` exposes no CORS, so the server proxies its raw HTML and the
 *  client parses it with `DOMParser`; the npm fallback returns structured
 *  packages (npm's registry already sends `Access-Control-Allow-Origin: *`). */
export type PiMarketplaceResponse =
  | { source: "pi.dev"; html: string; page: number }
  | { source: "npm"; packages: PiMarketplacePackage[]; total: number; page: number };

/** One pichamber-shipped built-in extension (e.g. Ark Agent Plan). */
export type PiBuiltinExtension = {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Whether its folder currently exists under `~/.pi/agent/extensions/`. */
  installed: boolean;
};

/** A single extension that the active Pi runtime currently loaded for this session. */
export type LoadedExtensionInfo = {
  /** Server-computed label for the settings UI. */
  label: string;
  /** Absolute path to the extension file or its package directory. */
  path: string;
  /** Origin label: the source string (e.g. `npm:foo`, a git URL, or a local path). */
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  commands: string[];
  tools: string[];
  /** When this loaded entry is one of pichamber's built-ins, its id (e.g. `ark-agent-plan`). */
  builtinId?: string;
};

/** Unified snapshot of all extension state for one session: built-ins pichamber ships, package
 *  sources Pi was told to load, the extensions that ended up loaded, and any load errors. */
export type ExtensionsOverview = {
  builtins: PiBuiltinExtension[];
  sources: PiExtensionSource[];
  loaded: LoadedExtensionInfo[];
  diagnostics: Array<{ path: string; error: string }>;
  /** False when the active runtime cannot enumerate extension inventory (e.g. external RPC). */
  inventoryAvailable: boolean;
};

/** A Skill discovered by Pi for the active session. */
export type LoadedSkillInfo = {
  name: string;
  description: string;
  path: string;
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  disableModelInvocation: boolean;
};

/** A Skill suppressed through Pi's global `skills` setting. */
export type DisabledSkillInfo = {
  name: string;
  description?: string;
  path: string;
};

/** Pi's discovered Skills and whether their slash commands are registered. */
export type SkillsOverview = {
  skills: LoadedSkillInfo[];
  disabledSkills: DisabledSkillInfo[];
  diagnostics: Array<{ path: string; error: string }>;
  enableSkillCommands: boolean;
  inventoryAvailable: boolean;
};

export type McpServerInfo = {
  name: string;
  source?: string;
  transport: "stdio" | "http" | "socket";
  status: "cached" | "not-connected" | "disabled";
  disabled: boolean;
  directTools: boolean | string[];
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  tools: Array<{ name: string; description?: string }>;
  resources: Array<{ name: string; description?: string }>;
  prompts: Array<{ name: string; description?: string }>;
};

export type McpOverview = { available: boolean; servers: McpServerInfo[]; error?: string };
