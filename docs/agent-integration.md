# pichamber × pi 集成:分步实施计划

> 本文档对应从 `packages/server` 出发,接入 `@earendil-works/pi-coding-agent` SDK,实现"web 端多会话切换 + 在每个 session 自己的项目目录里启动 agent"的目标。
>
> 每一小步都是独立可验证的:做完一步 type-check + 一个手工 curl/REPL 验证,再进下一步。

## 0. 总体架构

```
[Vue web]  ──HTTP/WS──▶  [Bun server (Hono)]
                              │
                              ├─ src/index.ts          (HTTP routes + WS handler)
                              └─ Map<sessionPath, AgentSessionRuntime>
                                       │
                                       │ 每个 session 一个 runtime
                                       ▼
                                  独立运行的 N 条 session
                                  (各自的 cwd 来自各自的文件头)
```

关键原则:

1. **每个被选中的 session 一个独立 runtime** —— 同时支持多条对话并行(多 tab / 多用户 / 后台任务)
2. **不调用 `runtime.switchSession()`** —— 每个 runtime 只服务一个 session,不切换
3. **路由处理函数直接调 SDK** —— 不预先建 service 层,YAGNI
4. **agent 的 cwd 永远来自 session 文件头** —— 读 `SessionManager.open(path).getHeader().cwd` 传进 `createAgentSessionRuntime`
5. **不发明新类型**:只用 SDK 已有的 `AgentSessionRuntime`、`AgentSession`、`AgentSessionEvent`

## 1. HTTP 端点:列 sessions

> **YAGNI 原则**:不要为 `SessionManager.listAll()` 这种一行调用包一层函数/文件。

### 1.1 修改 `packages/server/src/index.ts`

直接在路由处理函数里调 SDK,**不新建任何 service 文件**:

- `import { SessionManager } from "@earendil-works/pi-coding-agent";`
- `GET /api/sessions` → `return c.json(await SessionManager.listAll());`
- `GET /api/sessions/*` → 用 `c.req.path.slice('/api/sessions/'.length)` + `decodeURIComponent` 拿到 sessionPath,`SessionManager.open(sessionPath).getEntries()` 返回 JSON

### 1.2 验证

```bash
bun --filter @pichamber/server type-check
bun --filter @pichamber/server start
```

另开终端:

```bash
curl localhost:3000/api/health
curl localhost:3000/api/sessions | jq '.[0].cwd'
SP=$(curl -s localhost:3000/api/sessions | jq -r '.[0].path')
curl --get "localhost:3000/api/sessions/$(node -e "console.log(encodeURIComponent('$SP'))")" | jq '.[0].type'
```

⚠️ 如果 `~/.pi/agent/sessions/` 为空,`listAll()` 返回 `[]`。

### 1.3 何时才考虑抽出 service 文件

- 同一个调用在多个 route 出现且传参不同
- 需要包一层做缓存/错误处理/日志
- 测试需要 mock
- SDK API 不稳定需要 buffer

## 2. 已确认的后续步骤

Step 1 跑通后,接下来按顺序做:

- **Step 3**: Map<sessionPath, AgentSessionRuntime> 懒加载(每个被选中的 session 一个 runtime)
- **Step 4**: 消息发送端点(`runtime.session.prompt`)
- **Step 5**: WebSocket 把 `runtime.session.subscribe(...)` 的事件推给前端
- (Step 6 web 端,不属于 server 包)

不再预先设计更多步骤,做一步看一步。

## 3. Map<sessionPath, AgentSessionRuntime> 懒加载

### 3.1 修改 `packages/server/src/index.ts`

在 `app.get(...)` 旁边加:

- 工厂函数 `createRuntime` **完全照抄** `examples/sdk/13-session-runtime.ts` 的 `CreateAgentSessionRuntimeFactory` lambda
- `const runtimes = new Map<string, AgentSessionRuntime>()`
- `async function getRuntime(sessionPath: string): Promise<AgentSessionRuntime>`:
  - Map 里有就返回
  - 没有就:读 `SessionManager.open(sessionPath).getHeader().cwd` → `createAgentSessionRuntime(createRuntime, { cwd, agentDir: getAgentDir(), sessionManager: SessionManager.create(cwd) })` → `await runtime.session.bindExtensions({})` → 存入 Map → 返回
- `async function removeRuntime(sessionPath: string)`:从 Map 取出,`await runtime.dispose()`,从 Map 删

**不调 `runtime.switchSession()`** —— 每个 runtime 固定服务一个 session,生命周期跟 session 一一对应。

### 3.2 操作 runtime(全部都是 SDK 已有的方法)

| 动作 | SDK 调用 | 出处 |
|---|---|---|
| 建 runtime | `createAgentSessionRuntime(createRuntime, options)` | `core/sdk.ts` |
| 取当前活跃 session | `runtime.session`(getter) | `core/agent-session-runtime.ts` |
| 发消息 | `runtime.session.prompt(text)` | `core/agent-session.ts` |
| 订阅事件 | `runtime.session.subscribe(listener) → unsubscribe` | 同上 |
| 当前 session 文件路径 | `runtime.session.sessionFile` | 同上(getter) |
| 读 session header | `SessionManager.open(path).getHeader()` | `core/session-manager.ts` |
| 关停 | `await runtime.dispose()` | `core/agent-session-runtime.ts` |

### 3.3 不用到的方法

- `runtime.switchSession` / `runtime.newSession` / `runtime.fork` / `runtime.importFromJsonl` — 本设计不走 runtime 内部的状态切换,这些不调用(但不代表 SDK 没用,只是不适合 web 多会话场景)
- `session.bindExtensions({})` — 仅在 lazy 创建时调一次,不需要 rebind 模式

### 3.4 不发明的东西

- ❌ `RuntimeEntry` / `AgentHandle` — 都是我之前臆想的类型,SDK 没这两个,也不要造
- ❌ `services/agent.ts` — 先 inline 在 `index.ts`,以后真拆再说
- ❌ 自定义 fan-out `Set<...>` — Step 5 做多 ws 时再说
- ❌ `bindSession()` 重订模式 — 不需要,因为不会调 `switchSession`

### 3.5 验证

```bash
bun --filter @pichamber/server type-check
bun --filter @pichamber/server start
```

临时验证(REPL):

```bash
cd packages/server && bun repl
> const { getRuntime, runtimes } = await import("./src/index")
> const r1 = await getRuntime("/path/to/session.jsonl")
> const r2 = await getRuntime("/path/to/session.jsonl")
> console.log(r1 === r2)  // 应为 true,Map 缓存命中
> console.log(r1.session.sessionFile)  // 应等于传入的 path
```

⚠️ `createAgentSessionRuntime` 首次调用会检查 `~/.pi/agent/auth.json` 或环境变量里的 API key。如果没有,会报错。临时验证可能需要设 `ANTHROPIC_API_KEY` 之类。

### 3.6 设计取舍

| 维度 | 决定 | 理由 |
|---|---|---|
| 单 vs 多 runtime | **多** | 支持同时多个对话 |
| runtime 复用 vs 每次新建 | **复用(懒建)** | 重建 model client 代价高 |
| switchSession vs 独立 runtime | **独立** | 切 session 不丢上下文,符合 web 多 tab 场景 |
| 生命周期 owner | session path | 一个 session 一个 runtime,1:1 |

## 4. 消息发送 HTTP 端点

### 4.1 修改 `packages/server/src/index.ts`

新增路由(URL 形态 Hono `*` 通配可用,Step 1 验证过):

- `POST /api/sessions/*/messages` —— path 段携带 sessionPath,body `{ message }`

handler 行为:

1. 从 path 段解出 sessionPath(`c.req.path.slice(...).decodeURIComponent()`)
2. `const runtime = await getRuntime(sessionPath)`
3. **`runtime.session.prompt(body.message).catch(console.error)`** —— fire-and-forget

**重要**:`prompt()` 的 Promise 等到 retry/queue 全部结束才 resolve。HTTP handler 不能 await(请求会挂死),流式输出靠 Step 5 的 WebSocket 推。

### 4.2 验证

需要至少一个 provider 的 API key 已配置。

```bash
SP=$(curl -s localhost:3000/api/sessions | jq -r '.[0].path')
curl -X POST -H 'Content-Type: application/json' \
  -d '{"message":"hello"}' \
  --get "http://localhost:3000/api/sessions/$(node -e "console.log(encodeURIComponent('$SP'))")/messages"
```

应立刻返回,**不**等 agent 完成。

## 5. WebSocket 流式事件

### 5.1 修改 `packages/server/src/index.ts`

Bun 自带 WebSocket 升级,直接在 `export default { fetch, websocket }` 里挂 handler。

WS 协议(JSON,一帧一行):

**客户端 → 服务端**:

| 消息 | 含义 |
|---|---|
| `{type: "subscribe", sessionPath}` | 订阅该 session;服务端调 `getRuntime(path)` 拿到对应 runtime 并 subscribe |
| `{type: "unsubscribe", sessionPath}` | 取消订阅(从该 path 的 listener set 里移除) |
| `{type: "prompt", sessionPath, message}` | 在指定 session 上发消息(等价于 HTTP POST) |

**服务端 → 客户端**:

| 消息 | 含义 |
|---|---|
| `{type: "subscribed", sessionPath}` | subscribe 回执 |
| `{type: "event", sessionPath, event}` | `event` 是 `AgentSessionEvent` |
| `{type: "error", error}` | 出错 |

### 5.2 实现要点

- 维护 `Map<sessionPath, Set<WebSocket>>` —— 每个 session 各自一个 ws 订阅者 set
- 处理 `subscribe`:从 Map 取 runtime(不存在就 `getRuntime` 懒建),对该 runtime 的 session 调 `subscribe(listener)`(全局只挂一次,用 runtime 维度 fan-out),listener 内部查 Map 把 event 推给该 session 的所有 ws
- ws `close` 时清理该 ws 在所有 session set 里的记录
- 同一个 runtime 可能被多个 sessionPath 订阅?不会,`getRuntime(path)` 按 path 唯一对应一个 runtime
- **不主动 `removeRuntime`** —— runtime 跟 session 一一对应,生命周期跟 session 文件同寿,重启 server 会重新加载

### 5.3 验证

用 `websocat`:

```bash
websocat ws://localhost:3000/ws
> {"type":"subscribe","sessionPath":"/path/to/session.jsonl"}
< {"type":"subscribed","sessionPath":"..."}
> {"type":"prompt","sessionPath":"/path/to/session.jsonl","message":"hi"}
< {"type":"event","sessionPath":"...","event":{"type":"message_update",...},"assistantMessageEvent":{"type":"text_delta","delta":"..."}}
< {"type":"event","sessionPath":"...","event":{"type":"agent_end",...}}
```

确认 `text_delta` 能流式推过来,`agent_end` 在最后到达。

## 6. Web 端集成(本次范围之外,只列大纲)

新建/修改文件:

- `packages/web/src/stores/sessions.ts` — Pinia store
  - state: `sessions: SessionInfo[]`、`currentPath: string | null`、`messages: SessionEntry[]`、`isStreaming: boolean`
  - actions: `fetchSessions()`、`selectSession(path)`、`sendMessage(text)`、`onWsEvent(evt)`
- `packages/web/src/api/client.ts` — fetch 调 `/api/sessions` 系列
- `packages/web/src/api/ws.ts` — WebSocket 连接 + 重连 + 订阅管理
- `packages/web/src/components/SessionList.vue` — 按 `cwd` 分组展示 sessions
- `packages/web/src/components/ChatView.vue` — 消息列表 + 输入框,消费 ws 推送的 `text_delta`

不做的事:

- 没有"打开项目文件夹"创建新 session 的 UX(本阶段只支持打开已有 session)
- 没有鉴权 / 多用户隔离
- 没有扩展 UI 子协议 —— SDK 直调不需要这些

## 7. 不在本次范围 / 后续再说

- 服务端如何"知道"用户的项目目录在哪:目前假设 `~/.pi/agent/sessions/` 已经被各种方式填好
- 前端新建 session 的入口
- 跨 server 实例的 session 共享
- pi 的扩展系统本身

## 8. 引用

- SDK 总览:`@earendil-works/pi-coding-agent/docs/sdk.md`
- 工厂函数(`createRuntime` lambda)直接照搬:`@earendil-works/pi-coding-agent/examples/sdk/13-session-runtime.ts`
- 本设计**不调用**官方范例里的 `bindSession()` / `runtime.switchSession()`(它们是单 runtime 切换模式用的,我们走多 runtime 懒建)
- RPC 协议备查(本次不直接用,只是知识):`@earendil-works/pi-coding-agent/docs/rpc.md` / `docs/rpc.md`