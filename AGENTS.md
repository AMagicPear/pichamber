# AGENTS.md — pichamber

Vue 3 + Bun 薄壳，wrap `pi` coding agent + 真实 shell 终端。

## 准则

### 1. 最大化复用

例如用 Pi 的，不要重写。服务端直接 `import` `@earendil-works/pi-coding-agent`（runtime dep），调库函数；Pi 的类型直接 import，不重新声明。

### 2. 沿用既有模式，不发明新模式

加新功能前先 `grep` 整个 codebase 看同类问题怎么解的。

- HTTP → 扩展 `packages/web/src/api/client.ts`（`jsonOrThrow<T>`）
- WS 客户端 → 扩展 `packages/web/src/api/ws.ts`，URL 走 `wsUrl(path)`
- 服务端状态 → 模块级 `Map` + 导出函数，不写 class
- WS 服务端路由 → 实现 `WsHandler` 接口，`upgrade` 时把 handler 挂到 `ws.data.handler`
- 服务端算显示用的字符串（`~/foo` 折叠等），客户端不重复实现

### 3. 同样功能下，代码越少越好

不砍功能。同等实现里能合并就合并、能删就删。

## 约定

- **Pinia**：只放 UI 状态（主题/面板/布局），不放 server 数据
- **Vue `:key`**：必须用稳定 id，异步 server id 单独存字段 —— 改 key 会触发 unmount/remount，副作用很贵（PTY 那个 bug 就是这个）
- **图标**：`vite-svg-loader` 把 SVG 当 Vue 组件 import

## 命令

```bash
bun run dev         # server(:3000) + Vite(:5173)
bun run type-check
bun run lint
bun run build
```

浏览器调试：Kimi WebBridge `http://127.0.0.1:10086`。
