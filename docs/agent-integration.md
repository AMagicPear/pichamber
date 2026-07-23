# pichamber × pi 集成:分步实施计划

> 本文档对应从 `packages/server` 出发,接入 `@earendil-works/pi-coding-agent` SDK,实现"web 端多会话切换 + 在每个 session 自己的项目目录里启动 agent"的目标。
>
> 每一小步都是独立可验证的:做完一步 type-check + 一个手工 curl/REPL 验证,再进下一步。

## 0. 总体架构

```
[Vue web]  ──HTTP/WS──▶  [Bun server (Hono)]
                              │
                              ├─ src/index.ts          (HTTP routes, 22 行)
                              ├─ src/agent.ts          (运行时池)
                              │     Map<sessionPath, AgentSession>
                              │     getSession / removeSession
                              └─ src/ws/handler.ts     (Step 5)
                                       │
                                       │ 每个 session 一个 AgentSession
                                       ▼
                                  独立运行的 N 条 session
                                  (各自的 cwd 来自各自的文件头)
```

关键原则:

1. **每个被选中的 session 一个独立 `AgentSession`** —— 同时支持多条对话并行(多 tab / 多用户 / 后台任务)
2. **不调 `runtime.switchSession()`** —— 我们没有 runtime 包装,直接持有 `AgentSession`,每个固定服务一个 session
3. **路由处理函数直接调 SDK** —— 不预先建 service 层,YAGNI
4. **`createAgentSession` 而不是 `createAgentSessionRuntime` + factory** —— 因为我们从不切 session,工厂模式(为 `switchSession` 服务)不需要
5. **agent 的 cwd 永远来自 session 文件头** —— `SessionManager.open(path).getCwd()` 传进 `createAgentSession`
6. **不发明新类型**:只用 SDK 已有的 `AgentSession`、`AgentSessionEvent`、`SessionManager`、`createAgentSession`

## 1. HTTP 端点:列 sessions

> **YAGNI 原则**:不要为 `SessionManager.listAll()` 这种一行调用包一层函数/文件。

### 1.1 修改 `packages/server/src/index.ts`

直接在路由处理函数里调 SDK,**不新建任何 service 文件**:

- `import { SessionManager } from "@earendil-works/pi-coding-agent";`
- `GET /api/health` → `c.json({ ok: true })`
- `GET /api/sessions` → `return c.json(await SessionManager.listAll());`
- `GET /api/sessions/*` → 用 `c.req.path.slice('/api/sessions/'.length)` + `decodeURIComponent` 拿到 sessionPath,`SessionManager.open(sessionPath).getEntries()` 返回 JSON

⚠️ Hono 通配必须用 `*`(多段),不能用 `:path{*}`——后者会被 SmartRouter 解析为非法 regex 而**不**触发 fallback。

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

- **Step 3**: Map<sessionPath, AgentSession> 懒加载(每个被选中的 session 一个 AgentSession)
- **Step 4**: 消息发送端点(`session.prompt`)
- **Step 5**: WebSocket 把 `session.subscribe(...)` 的事件推给前端
- (Step 6 web 端,不属于 server 包)

不再预先设计更多步骤,做一步看一步。

## 3. Map<sessionPath, AgentSession> 懒加载

### 3.1 新建 `packages/server/src/agent.ts`

独立文件,不 inline 在 `index.ts`。理由:这一块将来会被 `index.ts` 和 `ws/handler.ts` 都用到,而且有自己的 state(`Map`),抽出来避免污染 HTTP 路由层。

完整文件内容(48 行):

```ts
import {
    type AgentSession,
    createAgentSession,
    getAgentDir,
    SessionManager,
} from "@earendil-works/pi-coding-agent";

const sessions = new Map<string, AgentSession>();

export async function getSession(sessionPath: string): Promise<AgentSession> {
    const cached = sessions.get(sessionPath);
    if (cached) return cached;

    const sm = SessionManager.open(sessionPath);
    const { session } = await createAgentSession({
        cwd: sm.getCwd(),
        agentDir: getAgentDir(),
        sessionManager: sm,
    });
    sessions.set(sessionPath, session);
    return session;
}

export async function removeSession(sessionPath: string) {
    const session = sessions.get(sessionPath);
    if (!session) return;
    session.dispose();
    sessions.delete(sessionPath);
}

export async function createSessionWithCwd(cwd: string): Promise<AgentSession> {
    const sessionManager = SessionManager.create(cwd);
    const { session } = await createAgentSession({
        cwd,
        agentDir: getAgentDir(),
        sessionManager: sessionManager,
    });
    sessions.set(session.sessionFile!, session); // 只有 inMemory() 的才会不存在文件路径
    return session;
}
```

### 3.2 为什么用 `createAgentSession` 而不是 `createAgentSessionRuntime` + factory

`createAgentSessionRuntime(factory, options)` 的工厂模式是为**单 runtime + 切 session** 场景设计的:factory 封装"如何为新 cwd 重建 services",runtime 内部在 `switchSession` / `newSession` 时反复调它。

我们走的是**多 AgentSession + 永不切 session**——每个 session 一个固定 cwd,不需要工厂。所以直接用更简单的 `createAgentSession(options)`,**一步到位**,返回 `{ session, ... }`。

| 我们用的 | 不用的 |
|---|---|
| `createAgentSession` | `createAgentSessionRuntime` |
| `createAgentSessionServices` |  |
| `createAgentSessionFromServices` |  |
| `CreateAgentSessionRuntimeFactory` |  |
| `AgentSession` | `AgentSessionRuntime` |
| `session.dispose()` (sync) | `runtime.dispose()` (async) |
| `runtime.switchSession` / `newSession` / `fork` |  |

### 3.3 关键调用(`getSession` 内)

| 调用 | 作用 |
|---|---|
| `SessionManager.open(sessionPath)` | 打开已有的 session 文件,拿到 manager(同一实例复用,避免开两次) |
| `sm.getCwd()` | 读 session 文件头里的 cwd 字段,直接返回 `string` |
| `createAgentSession({ cwd, agentDir, sessionManager })` | 创建 `AgentSession`,内部已完成 services 装配 + extensions bind,返回 `{ session }` |
| `sessions.set(sessionPath, session)` | 缓存 |

### 3.4 不发明的东西

- ❌ `RuntimeEntry` / `AgentHandle` — 都是我之前臆想的类型,SDK 没这两个,也不要造
- ❌ `runtimes` 改名为 `sessions`、`getRuntime` 改名为 `getSession` —— 因为持有的就是 `AgentSession`,不要用 `runtime` 这个含糊词
- ❌ 自定义 fan-out `Set<...>` — Step 5 做多 ws 时再说
- ❌ `bindExtensions({})` 单独调用 —— `createAgentSession` 内部已做,不要重复
- ❌ `bindSession()` 重订模式 —— 不需要,从来不切 session

### 3.5 验证

```bash
bun --filter @pichamber/server type-check
bun --filter @pichamber/server start
```

临时验证(REPL):

```bash
cd packages/server
SP="/Users/.../agent/sessions/--Users-x-projects-pichamber--/2026-07-23T..._uuid.jsonl"

bun -e "
import { getSession } from './src/agent';
const s1 = await getSession(process.argv[1]);
console.log('matches:', s1.sessionFile === process.argv[1]);  // true
const s2 = await getSession(process.argv[1]);
console.log('cache:', s1 === s2);                              // true
" "$SP"
```

⚠️ `createAgentSession` 首次调用会检查 `~/.pi/agent/auth.json` 或环境变量里的 API key。如果没有,会报错。临时验证需要设 `ANTHROPIC_API_KEY` 之类。

### 3.6 设计取舍

| 维度 | 决定 | 理由 |
|---|---|---|
| 单 vs 多 AgentSession | **多** | 支持同时多个对话 |
| AgentSession 复用 vs 每次新建 | **复用(懒建)** | 重建 model client 代价高 |
| switchSession vs 独立 AgentSession | **独立** | 切 session 不丢上下文,符合 web 多 tab 场景 |
| AgentSession vs AgentSessionRuntime | **AgentSession** | 不需要 runtime 的 session-replacement 能力 |
| 生命周期 owner | session path | 一个 session 一个 AgentSession,1:1 |
| 文件位置 | `src/agent.ts` | 独立,被 index 和 ws 都用,有自己的 state |

## 4. HTTP 写端点:创建 session + 发送消息

### 4.1 创建 session

新增路由:

- `POST /api/sessions`,body `{ cwd: string }`,返回 `{ sessionPath: string }`

handler:

```ts
app.post("/api/sessions", async (c) => {
    const { cwd } = await c.req.json<{ cwd: string }>();
    const session = await createSessionWithCwd(cwd);   // from ./agent
    return c.json({ sessionPath: session.sessionFile });
});
```

`POST /api/sessions` 和 `GET /api/sessions` method 不同、不冲突。

**重要约束**:`SessionManager.create(cwd)` 只创建目录 + 内存中的 session,**不立即写文件**。所以 `sessionPath` 指向的文件还没存在,要等第一次 `prompt()` 才会写盘。这带来的边界:

- ✅ `Map` 里有缓存期间,`getSession(sessionPath)` 命中,正常工作
- ⚠️ 如果服务端在第一次 prompt 之前重启,缓存丢,`getSession(sessionPath)` 会调 `SessionManager.open(path)`,找不到文件 → `getCwd()` fallback 到 `process.cwd()`,**原始 cwd 丢失**
- ✅ 第一次 prompt 后文件存在,以后都正常

实际不会出问题(用户 POST 完会马上发消息),但记一笔。

### 4.2 发送消息

新增路由:

- `POST /api/sessions/*/messages`,body `{ message: string }`

handler:

1. 从 path 段解出 sessionPath(`c.req.path.slice(...).decodeURIComponent()`)
2. `const session = await getSession(sessionPath)`
3. **`session.prompt(body.message).catch(console.error)`** —— fire-and-forget

**重要**:`prompt()` 的 Promise 等到 retry/queue 全部结束才 resolve。HTTP handler 不能 await(请求会挂死),流式输出靠 Step 5 的 WebSocket 推。

### 4.3 验证

需要至少一个 provider 的 API key 已配置。

```bash
# 创建
curl -X POST -H 'Content-Type: application/json' \
  -d '{"cwd":"/path/to/project"}' \
  http://localhost:3000/api/sessions
# {"sessionPath":"/Users/.../agent/sessions/--path-to-project--/2026-..._.jsonl"}

# 发消息
SP="/Users/.../agent/sessions/--path-to-project--/2026-..._.jsonl"
curl -X POST -H 'Content-Type: application/json' \
  -d '{"message":"hello"}' \
  --get "http://localhost:3000/api/sessions/$(node -e "console.log(encodeURIComponent('$SP'))")/messages"
```

发消息应立刻返回,**不**等 agent 完成。

## 5. WebSocket 流式事件(Hono)

用 Hono 的 `hono/bun` 适配器,不用额外装包(参考 https://hono.dev/docs/helpers/websocket)。

### 5.1 `packages/server/src/ws/handler.ts`

```ts
import { upgradeWebSocket, type WSContext } from "hono/bun";
import { Hono } from "hono";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { getSession, createSessionWithCwd } from "../agent";

type WsCtx = WSContext<unknown>;
// 每个 sessionPath -> 订阅它的 ws 集合 + 挂在该 session 上的 SDK listener
const subs = new Map<string, { session: import("@earendil-works/pi-coding-agent").AgentSession; sockets: Set<WsCtx> }>();
// 每个 ws -> 它订阅了哪些 sessionPath(close 时清理)
const wsOwn = new WeakMap<WsCtx, Set<string>>();

function attachListener(sessionPath: string, session: import("@earendil-works/pi-coding-agent").AgentSession) {
    if (subs.has(sessionPath)) return;  // 已挂过就不重复
    const sockets = new Set<WsCtx>();
    session.subscribe((evt: AgentSessionEvent) => {
        for (const ws of sockets) ws.send(JSON.stringify({ type: "event", sessionPath, event: evt }));
    });
    subs.set(sessionPath, { session, sockets });
}

export function wsRoutes(): Hono {
    const app = new Hono();
    app.get("/ws", upgradeWebSocket((_c) => ({
        onOpen: (_evt, ws) => wsOwn.set(ws, new Set()),
        onMessage: async (evt, ws) => {
            const msg = JSON.parse(evt.data as string);
            if (msg.type === "subscribe") {
                const session = await getSession(msg.sessionPath);
                attachListener(msg.sessionPath, session);
                subs.get(msg.sessionPath)!.sockets.add(ws);
                wsOwn.get(ws)!.add(msg.sessionPath);
                ws.send(JSON.stringify({ type: "subscribed", sessionPath: msg.sessionPath }));
            } else if (msg.type === "unsubscribe") {
                const entry = subs.get(msg.sessionPath);
                if (entry) entry.sockets.delete(ws);
                wsOwn.get(ws)?.delete(msg.sessionPath);
            } else if (msg.type === "prompt") {
                const session = await getSession(msg.sessionPath);
                session.prompt(msg.message).catch((err) => ws.send(JSON.stringify({ type: "error", error: String(err) })));
            }
        },
        onClose: (_evt, ws) => {
            const owned = wsOwn.get(ws);
            if (!owned) return;
            for (const path of owned) {
                const entry = subs.get(path);
                if (entry) entry.sockets.delete(ws);
            }
            wsOwn.delete(ws);
        },
    })));
    return app;
}
```

### 5.2 `packages/server/src/index.ts` 接入

```ts
import { wsRoutes } from "./ws/handler";
const app = new Hono();
// ... 现有路由 ...
app.route("/", wsRoutes());  // 挂上 /ws
export default { port: 3000, fetch: app.fetch, websocket };  // ← import websocket from "hono/bun"
```

### 5.3 关键设计点

- **同一个 session 只挂一次 SDK listener** —— 用 `subs.has(sessionPath)` 幂等保护,多 ws 订阅同一个 sessionPath 也只触发一次 `session.subscribe(...)`
- **fan-out 在 SDK listener 内部**:listener 读 `subs.get(path).sockets`,推到该 session 的所有 ws
- **`WeakMap<ws, Set<path>>`** —— 记录每个 ws 订阅了哪些 path,close 时反向清理
- **不主动 `removeSession`** —— session 跟 session 文件一一对应,生命周期跟文件同寿

### 5.4 验证

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

- 没有鉴权 / 多用户隔离
- 没有扩展 UI 子协议 —— SDK 直调不需要这些

## 7. 不在本次范围 / 后续再说

- 服务端如何"知道"用户的项目目录在哪:目前假设 `~/.pi/agent/sessions/` 已经被各种方式填好
- 跨 server 实例的 session 共享
- pi 的扩展系统本身

## 8. 引用

- SDK 总览:`@earendil-works/pi-coding-agent/docs/sdk.md`
- 本设计**不抄**官方 `examples/sdk/13-session-runtime.ts` 的工厂模式 —— 那是单 runtime + `switchSession` 场景,我们的多 session 场景不需要
- RPC 协议备查(本次不直接用,只是知识):`@earendil-works/pi-coding-agent/docs/rpc.md` / `docs/rpc.md`