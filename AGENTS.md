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

### 3. 同样功能下，代码越少越好

不砍功能。同等实现里能合并就合并、能删就删。

## 约定

- **Vue `:key`**：必须用稳定 id，异步 server id 单独存字段
- **图标**：`vite-svg-loader` 把 SVG 当 Vue 组件 import
- **函数风格**：实现代码优先 `const foo = (...) => {}`；`void` / `Promise<void>` 返回类型通常交给 TypeScript 推断，非 `void` 返回类型只有在 API 表达更清楚或推断不直观时再显式标注

## 命令

```bash
bun run dev         # server(:3000) + Vite(:5173)
bun run type-check
bun run lint
bun run build
```

浏览器调试：Kimi WebBridge `http://127.0.0.1:10086`。
