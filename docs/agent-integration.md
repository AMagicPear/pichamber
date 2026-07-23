# pichamber × pi 集成:分步实施计划

> 本文档对应从 `packages/server` 出发,接入 `@earendil-works/pi-coding-agent` SDK,实现"web 端多会话切换 + 在每个 session 自己的项目目录里启动 agent"的目标。
>
> 每一小步都是独立可验证的:做完一步 type-check + 一个手工 curl/REPL 验证,再进下一步。

## 0. 总体架构

```
[Vue web]  ──HTTP/WS──▶  [Bun server (Hono)]
                              │
                              ├─ http/routes.ts         (HTTP 端点, 直接调 SDK)
                              └─ ws/handler.ts          (WS 协议)
                                          │
                                          ▼
                                    AgentSessionRuntime (官方, lazy 按需建)
```

关键原则:

1. **服务器启动时没有任何 agent 在跑** —— 不调 `createAgentSessionRuntime`
2. **路由处理函数直接调 SDK** —— 不预先建 service 层,YAGNI
3. **每个 session 各自一个 runtime** —— 互不影响,切换 session 时可以销毁旧的(只在真的需要时再抽象)
4. **agent 的 cwd 永远来自 session 文件头** —— 跟在该 session 原本目录运行 `pi` CLI 行为一致
5. **不预先抽象**:同一函数被多处调用、要缓存、要 mock、SDK 不稳定时才抽

## 1. HTTP 端点:列 sessions

> **YAGNI 原则**:不要为 `SessionManager.listAll()` 这种一行调用包一层函数/文件。需要抽象的时候自然会抽象。

### 1.1 修改 `packages/server/src/http/routes.ts`

直接在路由处理函数里调 SDK,**不新建任何 service 文件**:

- `import { SessionManager } from "@earendil-works/pi-coding-agent";`
- 新增路由 `GET /api/sessions`,handler 里 `return c.json(await SessionManager.listAll());`
- 新增路由 `GET /api/sessions/:path(*)`,handler 里用 `SessionManager.open(path)` 拿到 manager 后取历史,返回 JSON

### 1.2 验证

```bash
bun --filter @pichamber/server type-check
bun --filter @pichamber/server dev
```

另开终端:

```bash
curl localhost:3000/api/sessions | jq '.[0].cwd'
curl 'localhost:3000/api/sessions/<full-path-of-one-session>' | jq '.[0].type'
```

⚠️ 如果 `~/.pi/agent/sessions/` 为空,`listAll()` 返回 `[]`。先用 `pi --mode print "hello"` 跑一下造一个 session 出来。

### 1.3 何时才考虑抽出 service 文件

出现以下任一情况再抽象(到时候单独讨论,不预先建):

- 同一个调用在多个 route 出现且传参不同
- 需要包一层做缓存/错误处理/日志
- 测试需要 mock
- SDK API 不稳定需要 buffer

## 2. (后续步骤待 Step 1 完成后细化)

Step 1 跑通后,我们再讨论:

- Lazy agent factory 怎么写(是真的需要,因为要 `Map<path, Runtime>`)
- 消息发送端点
- WebSocket 协议

现在不预先设计。

## 3. Lazy agent factory

### 3.1 新建 `packages/server/src/services/agent.ts`

职责:**按 session 路径**管理 `AgentSessionRuntime` 生命周期。每个路径独立一份。

内部状态:

- `Map<sessionPath, RuntimeEntry>` 缓存
- `RuntimeEntry` 至少包含:
  - runtime 实例
  - 当前活跃订阅者集合(`Set<AgentSessionEventListener>`)
  - session 引用

导出函数:

| 函数 | 签名 | 行为 |
|---|---|---|
| `getAgent` | `(sessionPath: string) => Promise<AgentHandle>` | Map 里没有 → 新建(用 session 文件头的 cwd 建 runtime,rebind);有 → 直接返回 |
| `disposeAgent` | `(sessionPath: string) => Promise<void>` | 清订阅 + `runtime.dispose()` + 从 Map 删 |

`AgentHandle` 接口(同文件内导出,types only):

| 方法/属性 | 类型 | 说明 |
|---|---|---|
| `session` | `AgentSession` | 当前活跃 session |
| `subscribe` | `(listener) => () => void` | 注册事件监听;返回的函数取消注册 |
| `prompt` | `(text, opts?) => Promise<void>` | 转发到 `session.prompt` |
| `steer` | `(text) => Promise<void>` | 转发到 `session.steer` |
| `followUp` | `(text) => Promise<void>` | 转发到 `session.followUp` |
| `abort` | `() => Promise<void>` | 转发到 `session.abort` |
| `dispose` | `() => Promise<void>` | 等价于 `disposeAgent(handle.sessionFile)` |

关键设计点(用文字描述,不在 spec 里写代码):

- **创建 runtime 时,cwd 来自 session 文件头**:用 `SessionManager.open(path)` 或者直接读 jsonl 第一行拿到 header.cwd,然后把 cwd 传进 `createAgentSessionRuntime(createRuntime, { cwd: headerCwd, agentDir: getAgentDir(), sessionManager: ... })`
- **runtime 工厂函数**完全照抄官方 `examples/sdk/13-session-runtime.ts`(`createAgentSessionServices` + `createAgentSessionFromServices` + `createAgentSessionRuntime`)
- **不调 `runtime.newSession()` / `runtime.switchSession()`** —— 我们要的是"按需建独立 runtime",不是"切换全局 active session"
- `getAgent` 同路径二次调用应该返回同一个 handle(`Map` 缓存保证)

### 3.2 验证

```bash
bun --filter @pichamber/server type-check
```

在 Bun REPL:

```bash
> import { getAgent } from "./src/services/agent"
> const a = await getAgent("/path/to/some/session.jsonl")
> const b = await getAgent("/path/to/some/session.jsonl")
> console.log(a === b)   // 应为 true
> console.log(a.session.sessionFile)   // 应等于传入的 path
> await a.dispose()
```

## 4. 消息发送 HTTP 端点

### 4.1 修改 `packages/server/src/http/routes.ts`

新增路由:

| 方法 | 路径 | body | 处理 |
|---|---|---|---|
| `POST` | `/api/sessions/:path(*)/messages` | `{ message: string }` | `getAgent(path)` 拿 handle,然后 **`handle.prompt(body.message).catch(console.error)`**(fire-and-forget) |

**重要**:`prompt()` 的 Promise 会等到 retry / queue 全部结束才 resolve。如果在 HTTP handler 里 await,请求会长时间挂死。所以必须 fire-and-forget,流式输出靠下一步的 WebSocket 推。

### 4.2 验证

需要先有会话在跑(本地有 `~/.pi/agent/sessions/` 里的真实 session,以及至少一个 provider 的 API key 已配置)。

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"message":"hello"}' \
  'http://localhost:3000/api/sessions/<path>/messages'
```

应立刻返回 200 / 202,**不**等 agent 完成。在 server 日志里能看到 prompt 被接收,以及 agent 的流式活动。

## 5. WebSocket 流式事件

### 5.1 修改 `packages/server/src/ws/handler.ts`(目前是空骨架)

WS 协议(JSON,一帧一行):

**客户端 → 服务端**:

| 消息 | 含义 |
|---|---|
| `{type: "subscribe", sessionPath}` | 订阅该 session 的事件流 |
| `{type: "unsubscribe", sessionPath}` | 取消订阅 |
| `{type: "prompt", sessionPath, message}` | 等价于走 HTTP POST,方便纯 WS 客户端 |

**服务端 → 客户端**:

| 消息 | 含义 |
|---|---|
| `{type: "subscribed", sessionPath}` | subscribe 成功回执 |
| `{type: "unsubscribed", sessionPath}` | unsubscribe 回执 |
| `{type: "event", sessionPath, event}` | `event` 字段是 `AgentSessionEvent` |
| `{type: "error", sessionPath?, error}` | 出错 |

实现要点:

- 维护 `Map<WebSocket, Set<sessionPath>>`:每条 ws 各自跟踪订阅了哪些 session
- 处理 `subscribe` 时:如果 `getAgent(path)` 的缓存里没有,**立即**创建(用户既然订阅了就说明他很快要发消息,提前起 agent 避免首字延迟)
- `subscribe` 注册一个 listener 到 `handle.subscribe(...)`,listener 内部查 `Map` 把 event 推给所有订阅了该 path 的 ws
- ws `close` 时,清理该 ws 在 Map 里的记录;**不**自动 disposeAgent(可能有其它 ws 还订阅着)
- `prompt` 通过 WS 发时,行为跟 HTTP POST 一致:`handle.prompt(message).catch(...)`

### 5.2 验证

用 `websocat` 或手写 nc 脚本:

```bash
websocat ws://localhost:3000/ws
> {"type":"subscribe","sessionPath":"/path/to/session.jsonl"}
< {"type":"subscribed","sessionPath":"..."}
> {"type":"prompt","sessionPath":"...","message":"hi"}
< {"type":"event","event":{"type":"message_update",...},"assistantMessageEvent":{"type":"text_delta",...}}
< {"type":"event","event":{"type":"agent_end",...}}
```

确认 `text_delta` 能流式推过来,`agent_end` 在最后到达。

## 6. Web 端集成(本次范围之外,只列大纲)

> 之所以单独列,是因为这一层不属于 `packages/server`,但用户提了"web 调用"的最终目标。

新建/修改文件:

- `packages/web/src/stores/sessions.ts` — Pinia store
  - state: `sessions: SessionInfo[]`、`currentPath: string | null`、`messages: SessionEntry[]`、`isStreaming: boolean`
  - actions: `fetchSessions()`、`selectSession(path)`、`sendMessage(text)`、`onWsEvent(evt)`
- `packages/web/src/api/client.ts` — fetch 调 `/api/sessions` 系列
- `packages/web/src/api/ws.ts` — WebSocket 连接 + 重连 + 订阅管理
- `packages/web/src/components/SessionList.vue` — 按 `cwd` 分组展示 sessions
- `packages/web/src/components/ChatView.vue` — 消息列表 + 输入框,消费 ws 推送的 `text_delta`

不做的事:

- 没有"打开项目文件夹"创建新 session 的 UX(本阶段只支持打开已有 session,跟用户当前描述一致)
- 没有鉴权 / 多用户隔离
- 没有扩展 UI 子协议(select/confirm/input 等)—— SDK 直调不需要这些

## 7. 不在本次范围 / 后续再说

- 服务端如何"知道"用户的项目目录在哪:目前假设 `~/.pi/agent/sessions/` 已经被各种方式填好(`pi` CLI 在用户机器上跑过、或者别的方式)
- 前端新建 session 的入口
- 跨 server 实例的 session 共享
- pi 的扩展系统本身(目前假设用户的 `~/.pi/agent/extensions/` 没有或者不需要)

## 8. 引用

- SDK 总览:`@earendil-works/pi-coding-agent/docs/sdk.md`
- 多 session runtime 范例:`@earendil-works/pi-coding-agent/examples/sdk/13-session-runtime.ts`
- RPC 协议备查(本次不直接用):`@earendil-works/pi-coding-agent/docs/rpc.md` / `docs/rpc.md`
- 本仓库已有的服务文件骨架:`packages/server/src/services/process.ts`(留作历史占位)、`packages/server/src/services/command.ts`(同上)