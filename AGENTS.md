# AGENTS.md — Pichamber

## 核心准则

### 准则一：能抄就抄，更准确说是"用 Pi 的，不要重写"

pichamber 是 Pi 的薄壳前端。**任何 Pi 已经提供的能力（类型、事件、状态、工具），pichamber 都不应重新实现、重新定义、重新计算。**

搬运优先级：

1. **Pi 运行时** — 通过 `client.request()` 调 RPC、订阅事件。直接用 Pi 返回的数据。
2. **Pi npm 包** — `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent`（作为 devDependencies）。**直接 import 它们的类型与运行时函数**——不复制。
3. **OpenChamber 源代码** (`/Users/amagicpear/projects/pichamber-plans/openchamber`) — UI 结构、样式、交互模式。
4. 以上三个都没有，才自己写。

> 反例（已删除）：
> - 自定义 `ChatMessage` UI 类型 → 用 Pi 的 `Message` / `AssistantMessage` / `UserMessage` / `ToolResultMessage`
> - 自定义 `ModelInfo` → 用 Pi 的 `Model<Api>`
> - 自定义 `reduceRuntimeEvent` → 用 Pi 事件 + 单一 reducer
> - 自定义 `getSupportedThinkingLevels` 实现 → 直接 `import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"`
> - 自定义 `sessionKey(path)` 32-bit hash → 直接用 session 文件里的 `id`

### 准则二：代码越少越好

功能体验不缺席的前提下，代码总量越少越好。能删就删，能合并就合并。

## 开发命令

```bash
bun run dev:all     # 同时启动后端(:1420) + Vite 前端(:5173)
bun run build       # 生产构建
bun run check       # tsc + eslint
bun run test        # vitest
bun update @earendil-works/pi-ai @earendil-works/pi-agent-core @earendil-works/pi-coding-agent
                    # Pi 升级时执行——pichamber 自动跟随协议变更
```

## 架构

```
Browser ──fetch/WS──> Bun/TypeScript HTTP server ──stdin/stdout──> Pi RPC processes
                          │
                          ├── PTY management (Bun.Terminal)
                          ├── File system (workspace-scoped)
                          └── Session listing (Pi JSONL store)  ← TODO: 替换为 Pi RPC `list_sessions`
```

- 前端 React + Vite，直接连接 `localhost:1420` 后端（无代理）
- 后端 Bun HTTP，spawn `pi --mode rpc` 子进程，通过 WebSocket 转发 JSON-RPC
- **Pi 是 session 的唯一真相源**：messages、state、tool calls、UI requests 全部由 Pi 推送
- pichamber 只做镜像渲染 + 转发 UI 意图

## Pi 依赖（devDependencies）

pichamber 把以下 Pi 包作为 `devDependencies` 直接 import，**不复制任何类型或函数实现**：

| Package | 提供 |
|---|---|
| `@earendil-works/pi-ai` | `Model<TApi>`、`ThinkingLevel`、`ModelThinkingLevel`、`Message`、`UserMessage`、`AssistantMessage`、`ToolResultMessage`、`TextContent`、`ThinkingContent`、`ToolCall`、`ImageContent`、`AssistantMessageEvent`、`Usage`、`StopReason`、`getSupportedThinkingLevels`、`clampThinkingLevel` |
| `@earendil-works/pi-agent-core` | `AgentMessage`、`AgentEvent` |
| `@earendil-works/pi-coding-agent` | `AgentSessionEvent`、`RpcCommand`、`RpcResponse`、`RpcSessionState`、`RpcExtensionUIRequest`、`RpcExtensionUIResponse`、`SessionInfo`、`SessionTreeNode` |

**锁定版本与 Pi CLI 一致**——`^0.80.10`。Pi 升级时执行 `bun update @earendil-works/pi-*` 即可，pichamber 自动跟随协议变更。

> 为什么是 `devDependencies` 而不是 `dependencies`？
> pichamber 的前端是 browser bundle，不能真的 import Pi 的 Node-only 运行时（会触发 AWS SDK、Anthropic SDK 等 6.4MB 依赖）。用 devDependencies + `import type` 让 TypeScript 在编译期拿到类型，Vite 在 bundle 期不会把 Pi 代码打进去。`getSupportedThinkingLevels` 等纯函数因为无 Node 依赖、可被 tree-shake，运行时 import 也是安全的。

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/runtime/types.ts` | Pichamber 自己的 UI 类型（Project/SessionTab/OpenFile/TreeEntry）+ re-export Pi 类型 |
| `src/runtime/events.ts` | 单一事件 reducer：`SessionView = fold(Pi events)` |
| `src/runtime/use-pichamber.ts` | UI 意图 → Pi RPC 的薄层 |
| `src/runtime/rpc-client.ts` | WebSocket JSON-RPC 客户端（无业务逻辑） |
| `src/runtime/registry.ts` | per-session RpcClient 缓存 |
| `src/stores/app-store.ts` | 只剩 UI 偏好（theme/sidebar/pi path）+ 1 个 `SessionView` |
| `src-server/server.ts` | Bun HTTP 服务器 |
| `src-server/rpc.ts` | Pi 进程管理 |
| `src-server/sessions.ts` | **TODO**：替换为 Pi RPC `list_sessions` 命令 |
| `src-server/workspace.ts` | 文件树/读取（pichamber 自己的能力） |
| `src-server/pty.ts` | PTY 终端 |

## 未来 Pi 需要补的 RPC 命令

彻底去掉 pichamber 自己的逻辑还需 Pi 端：

1. **`list_sessions`** — 列出所有 session（替代 `src-server/sessions.ts`）
2. **`delete_session`** — 删除 session（替代 HTTP 端点）
3. **`get_session_stats`** — 已有但未在 UI 暴露
4. **`entry_appended` 事件配套 reactive sidebar 更新** — 替代 5s 轮询
