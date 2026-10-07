# Pi 0.85.1 → 1.0.4 适配记录

项目在提交 `0f0060e` 将 Pi 三个官方包从 `0.85.1` 同步到 `1.0.4`。此记录覆盖这个版本区间，依据随 SDK 发布的 CHANGELOG 与 `docs/sdk.md`、`mcp.md`、`codemode.md`、`settings.md`、`extensions.md`、`virtual-models.md`。

## 功能与修改清单

| 上游版本 | 新功能或行为修改 | Pichamber 适配 |
| --- | --- | --- |
| 0.86.0 | streaming/idle 提示词缓存保温，费用计入 usage | 行为设置新增 off/streaming/idle，通过 `session.setCacheWarmingMode()` 即时生效；usage entry 追加时刷新费用。 |
| 0.86.0 | 按模型配置 compaction 预算 | 官方 SettingsManager 原样读取 `compaction.modelOverrides`，继续使用官方 compaction 与统计。 |
| 0.86.0 | TranscriptContext、JSON 参数/details、工具与提示词增量更新 | 继续传输官方消息/事件与类型，内置 provider 复用官方 adapter，无自建转换层。 |
| 0.86.0–0.87.1 | `/bug`、Meta Muse、新版 Claude/GPT/Grok 模型和默认模型变化 | Web 使用自有诊断导出；提供商与聊天模型由官方 registry 动态枚举，继承新增模型与 provider。 |
| 0.87.0 | SessionManager 成为模型上下文权威来源，append-only context_edit | 继续回复改用 `appendContextEdit()` 省略失败尝试，保留原始历史；复用官方完整运行入口，执行重试、压缩与 `agent_before_settle` 续跑。 |
| 0.87.0 | actionable turn_end/agent_before_settle、context_with_system | 官方 SDK 执行扩展边界；Web 仍以 `agent_settled` 判断最终完成。 |
| 0.87.0 | 按模型限制图片尺寸 | 由官方 prompt/read/tool-result 图像处理路径执行，前端显示官方 content。 |
| 0.99.0 | 官方 MCP、codemode、tool_search | SDK 显式加载三个官方 factory，使用 `builtin: true`、`replaceable: true`，遵循 `-builtin:*` 配置。RPC 后端由官方 CLI 自行加载。 |
| 0.99.0 | MCP stdio/streamable HTTP、OAuth、resources | 删除 adapter 配置/缓存依赖，管理页展示官方连接状态、错误和工具；重连与登录/退出调用官方命令。资源由官方 resource tools 提供。 |
| 0.99.0–1.0.4 | MCP 暴露策略、后台连接、重连、动态工具列表与工具命名 | 管理页支持 codemode/deferred/direct/hidden；原样复用官方工具注册与发现。sciverse 保持 direct，其余按配置间接调用。 |
| 0.99.1–0.99.2 | GPT-6.1 Sol、MCP clientName/provider token、Anthropic workload identity | registry 与官方认证实现原样支持；MCP description 与 toolExposure 等保留官方配置语义。 |
| 1.0.1 | MCP 项目覆盖、OAuth CIMD | 原样读取官方 global/project 配置与信任决定；页面在受信项目内为 global 服务器保存项目覆盖。CIMD 等 OAuth 参数由官方实现读取。 |
| 1.0.1 | Cloudflare Clef 分类模型、registerToolRenderer | Clef 可通过官方 codemode 调用。Web 继续用 Vue 渲染工具，识别官方命名空间并在服务器连接前显示历史调用。 |
| 0.99.0 | exposure/namespace/annotations/outputSchema、嵌套执行 | 不重建工具执行链；官方 `parentToolCallId` 事件归入父工具，最终历史读取 `nestedCalls`，避免重连后子调用行消失。 |
| 0.99.0 | classifier/image ModelRuntime，虚拟模型 | 继续使用官方 runtime，classifier/image 不混入聊天模型列表。修正上下文面板，实际响应的 provider/model 成对显示。 |
| 0.99.0 | OpenAI ChatGPT OAuth、provider_stream_event | 提供商页面新增官方 OAuth 登录与取消/回填对话框，支持 OAuth 凭据移除；原生 provider 事件由 SDK 执行。 |
| 1.0.0 | Anthropic copy-code 登录、Radius 登录 | Web 登录桥复用官方 `AuthInteraction`，支持 text/select/manual_code、授权 URL 和 device code；Radius MCP 仍通过官方 `mcp.json` 配置。 |
| 1.0.0–1.0.4 | codemode 更短提示词、分类/图像生成、图像落盘与 read 图片返回 | 启用官方 codemode；显示脚本、嵌套调用、文字与图片，live partialResult 和 finalized message 共用提取逻辑。 |
| 1.0.2 | samplingParamsByThinkingLevel | 官方 `models.json` 与 adapter 原样支持，无需前端复制采样逻辑。 |
| 1.0.3 | Azure provider 从 azure-openai-responses 改名为 azure，Foundry Chat Completions | 项目动态枚举 registry，无旧 ID 硬编码；本机 settings/models/auth 未发现旧 ID，无须修改。 |
| 1.0.4 | 工具通配符、--no-mcp、--tools 默认保留 MCP | RPC 使用随项目安装的官方 CLI；SDK 使用官方工具筛选逻辑。 |
| 0.99.0 | ExtensionToolContext、RPC prompt disposition | 版本同步提交已完成类型与 RPC 返回值适配，继续保留事件驱动处理。 |
| 当前 SDK | 流式快照 assistant.stopReason 为 pending | 重连时同时识别 pending 和未设置 stopReason 的快照，后续 delta 合并到同一消息。 |

SDK 自动继承的修复还包括 OAuth refresh 竞争、MCP scope/issuer/redirect 验证、MCP 连接中的 shutdown、工具名冲突、延迟工具 reload/resume、供应商溢出与容量重试、定价与 reasoning、隐藏工具的提示词规则及 codemode 输出/内存限制。没有在项目中复制这些算法。

## 配置入口

- 用户服务器：`~/.pi/agent/mcp.json`；受信项目服务器/覆盖：`.pi/mcp.json`。
- 新增/移除服务器：`pi mcp add`、`pi mcp remove`，或编辑上述文件。外部修改后，在当前会话运行 `/reload`。
- 工具默认集合、`codemode.mode/inlineBudget`、`compaction.modelOverrides`、模型图像尺寸与采样参数继续使用官方 settings/models 文件。它们已生效，没有为每个配置项增加重复的 Web 编辑器。
- MCP 的 legacy SSE、socket 和 prompts 不是官方实现的支持范围，页面不再展示 adapter 独有目录。
- TUI fullscreen/system theme、终端键位/图像/剪贴板、Nix 与 managed installer、CLI `/bug` 等仅影响官方终端，不映射成 Web 界面功能。

## 本机迁移

移除 `npm:pi-mcp-adapter` 和 `-builtin:mcp`，将原配置迁移到官方 `mcp.json`。GitHub 改为官方 `headers.Authorization` 命令值，通过本机已登录的 `gh auth token` 读取凭据；`directTools: true` 改为 `exposure: direct`。服务器 `PaddleOCR-VL-1.6` 改名为 `PaddleOCR-VL-1_6`，适配官方名称规则。

迁移前配置备份为 `~/.pi/agent/settings.pre-native-mcp.json`、`~/.pi/agent/mcp-adapter.pre-native-mcp.json`。当前正在执行的会话仍保留已经加载的扩展，下一次 `/reload` 或重启后切换至官方工具。

最终官方连接检查六个服务器全部成功：Blender 9 个工具、Dinox 4 个、GitHub 46 个、Zotero 16 个、PaddleOCR 1 个、Sciverse 6 个，配置错误为零。GitHub 原配置缺少 `GITHUB_PERSONAL_ACCESS_TOKEN`，已改为复用本机 GitHub CLI 的凭据；Zotero 在首次检查时不可达，最终复查已恢复连接。

## SDK 边界与验证

1.0.4 尚未从包入口导出 MCP 配置读写函数，也没有公开 `AgentSession.continue()`。配置管理直接调用官方配置模块；状态展示解析官方 `/mcp` 非 TUI 输出；继续回复复用 `_runAgentPrompt([])`，避免手写运行生命周期。这些边界由集成测试覆盖，上游发布相应公共 API 后应直接替换。

验证包括：实际 stdio MCP 初始化、延迟工具发现与激活、工具调用、资源读取与重连；继续回复的 canonical context 与 settle boundary；pending 快照续写、嵌套调用历史恢复、文字/图片结果；OAuth 浏览器回填与凭据隔离。另执行整个仓库的测试、类型检查和生产构建。
