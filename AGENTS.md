# AGENTS.md — Pichamber

## 核心准则

### 准则一：能抄就抄

搬运优先级：

1. **Pi 源代码** (`/Users/amagicpear/projects/pichamber-plans/pi`) — 逻辑、算法、类型定义，直接复制
2. **OpenChamber 源代码** (`/Users/amagicpear/projects/pichamber-plans/openchamber`) — UI 结构、样式、交互模式，直接复制
3. 以上两个都没有，才自己写

自己写得越少，对齐越好，bug 越少。

### 准则二：代码越少越好

功能体验不缺席的前提下，代码总量越少越好，越简洁越好。能删就删，能合并就合并，能一行解决的问题不写两行。

## 开发命令

```bash
bun run dev:all     # 同时启动后端(:1420) + Vite 前端(:5173)
bun run build       # 生产构建
```

## 架构

- 前端 React + Vite，直接连接 `localhost:1420` 后端（无代理）
- 后端 Bun HTTP，spawn `pi --mode rpc` 子进程，通过 WebSocket 转发 JSON-RPC
- Pi 是 session 的唯一真相源，Pichamber 只做镜像

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/runtime/use-pichamber.ts` | 与 Pi RPC 交互的核心 hooks |
| `src/runtime/types.ts` | 共享类型（尽量从 Pi 复制） |
| `src/runtime/rpc-client.ts` | WebSocket RPC 客户端 |
| `src/stores/app-store.ts` | Zustand 全局状态 |
| `src-server/server.ts` | Bun HTTP 服务器 |
| `src-server/rpc.ts` | Pi 进程管理与 WS 代理 |
| `src-server/sessions.ts` | Session 发现（镜像 Pi 的 SessionManager） |
| `src/features/chat/` | 聊天 UI |
| `src/features/workspace/` | 侧边栏 |
| `src/features/files/` | 文件查看器 |

## 类型对齐

所有与 Pi 交互的类型必须直接复制 Pi 源码中的定义，不要自己编。参考：
- `packages/ai/src/models.ts` — `getSupportedThinkingLevels`, `clampThinkingLevel`
- `packages/ai/src/types.ts` — `ThinkingLevelMap`, `Model`
- `packages/coding-agent/src/core/session-manager.ts` — session 编码规则
